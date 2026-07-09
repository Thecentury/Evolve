import { global, tmp_vars, save, sizeApproximation } from './vars.js';
import { loc } from './locale.js';
import { vBind, clearElement, timeCheck, arpaTimeCheck, popover, clearPopper } from './functions.js';
import { actions } from './actions.js';
import { traits, fathomCheck } from './races.js';
import { resource_values } from './resources.js';

// Auto-buy / auto-sell market orders.
//
// These orders are deliberately kept OUT of the game's `global` state so that they are not part of the
// game save; instead they are persisted separately in local storage (see saveOrders / loadOrders).
//
// There are three kinds of order, each uniquely keyed so a duplicate create is a no-op:
//   - buy      : keyed by resource, auto-buys that resource            -> autoMarket.buy[res]
//   - sell     : keyed by resource, auto-sells that resource           -> autoMarket.sell[res]
//   - building : keyed by build-queue id, auto-buys the slowest-to-obtain (tradable) resource
//                that the building needs; retargets automatically and cancels once the building
//                is no longer anywhere in the build queue -> autoMarket.building[id]
export const autoMarket = {
    buy: {},
    sell: {},
    building: {}
};

const STORAGE_KEY = 'evolvedAutoMarket';

// Sliding observation window, in samples. The tick runs once per second, so this is 60 seconds.
const WINDOW = 60;
// A buy is allowed when the current buy price is at most 10% above the sliding lowest price.
const BUY_THRESHOLD = 1.10;
// A sell is allowed when the current sell price is at least 90% of the sliding highest price.
const SELL_THRESHOLD = 0.90;
// A sell only happens when the resource is at least 90% of its max stock.
const STOCK_THRESHOLD = 0.90;

// The auto-market is paced to real wall-clock time (about once per second), independent of how often
// the game's mid loop fires. The mid loop runs ~1/s in normal time, but ~2/s under accelerated time and
// in fast bursts during catch-up, so we gate on elapsed real time instead of on the loop itself.
const TICK_INTERVAL = 1000; // ms
// Small tolerance so a mid loop landing a few ms early (timer jitter) still counts as "a second passed".
const TICK_TOLERANCE = 50; // ms
let lastTick = 0;

// Per-resource price history: { [res]: { buy: number[], sell: number[] } }. Transient, never persisted.
const priceHistory = {};

/*********************** Persistence ***********************/

export function saveOrders(){
    try {
        let data = {
            buy: Object.keys(autoMarket.buy),
            sell: Object.keys(autoMarket.sell),
            building: Object.keys(autoMarket.building).map(function(id){
                return { id: id, label: autoMarket.building[id].label };
            })
        };
        save.setItem(STORAGE_KEY, JSON.stringify(data));
    }
    catch (e){}
}

export function initAutoMarket(){
    autoMarket.buy = {};
    autoMarket.sell = {};
    autoMarket.building = {};
    try {
        let raw = save.getItem(STORAGE_KEY);
        if (raw){
            let data = JSON.parse(raw);
            (data.buy || []).forEach(function(res){ autoMarket.buy[res] = {}; });
            (data.sell || []).forEach(function(res){ autoMarket.sell[res] = {}; });
            (data.building || []).forEach(function(b){
                autoMarket.building[b.id] = { label: b.label, res: false };
            });
        }
    }
    catch (e){}
}

/*********************** Order management ***********************/

function tradeAllowed(){
    return !global.race['no_trade'];
}

export function hasBuyOrder(res){ return autoMarket.buy.hasOwnProperty(res); }
export function hasSellOrder(res){ return autoMarket.sell.hasOwnProperty(res); }
export function hasBuildingOrder(id){ return autoMarket.building.hasOwnProperty(id); }

// Toggle helpers used by the buttons. Returns the new active state.
export function toggleBuyOrder(res){
    if (hasBuyOrder(res)){
        delete autoMarket.buy[res];
        saveOrders();
        drawAutoMarket();
        return false;
    }
    if (!tradeAllowed()){ return false; }
    autoMarket.buy[res] = {};
    saveOrders();
    drawAutoMarket();
    return true;
}

export function toggleSellOrder(res){
    if (hasSellOrder(res)){
        delete autoMarket.sell[res];
        saveOrders();
        drawAutoMarket();
        return false;
    }
    if (!tradeAllowed()){ return false; }
    autoMarket.sell[res] = {};
    saveOrders();
    drawAutoMarket();
    return true;
}

export function toggleBuildingOrder(id, label){
    if (hasBuildingOrder(id)){
        delete autoMarket.building[id];
        saveOrders();
        drawAutoMarket();
        return false;
    }
    if (!tradeAllowed()){ return false; }
    autoMarket.building[id] = { label: label, res: false };
    saveOrders();
    drawAutoMarket();
    return true;
}

function orderCount(){
    return Object.keys(autoMarket.buy).length + Object.keys(autoMarket.sell).length + Object.keys(autoMarket.building).length;
}

/*********************** Pricing ***********************/

// Per-unit buy price, mirroring the manual purchase logic in resources.js (marketItem.purchase).
export function marketBuyPrice(res){
    let value = global.resource[res].value;
    if (global.race['arrogant']){
        value *= 1 + (traits.arrogant.vars()[0] / 100);
    }
    if (global.race['conniving']){
        value *= 1 - (traits.conniving.vars()[0] / 100);
    }
    let fathom = fathomCheck('imp');
    if (fathom > 0){
        value *= 1 - (traits.conniving.vars(1)[0] / 100 * fathom);
    }
    return value;
}

// Per-unit sell price, mirroring the manual sell logic in resources.js (marketItem.sell).
export function marketSellPrice(res){
    let divide = 4;
    if (global.race['merchant']){
        divide *= 1 - (traits.merchant.vars()[0] / 100);
    }
    let gobFathom = fathomCheck('goblin');
    if (gobFathom > 0){
        divide *= 1 - (traits.merchant.vars(1)[0] / 100 * gobFathom);
    }
    if (global.race['asymmetrical']){
        divide *= 1 + (traits.asymmetrical.vars()[0] / 100);
    }
    if (global.race['conniving']){
        divide *= 1 - (traits.conniving.vars()[1] / 100);
    }
    let impFathom = fathomCheck('imp');
    if (impFathom > 0){
        divide *= 1 - (traits.conniving.vars(1)[1] / 100 * impFathom);
    }
    return global.resource[res].value / divide;
}

// Executes a market purchase of up to `qty` units, mirroring marketItem.purchase. Returns the amount bought.
function doPurchase(res, qty){
    let value = marketBuyPrice(res);
    let amount = Math.floor(Math.min(qty, global.resource.Money.amount / value,
      global.resource[res].max - global.resource[res].amount));
    if (amount > 0){
        global.resource[res].amount += amount;
        global.resource.Money.amount -= Math.round(value * amount);
        global.resource[res].value += Number((amount / Math.rand(1000,10000)).toFixed(2));
    }
    return amount;
}

// Executes a market sale of up to `qty` units, mirroring marketItem.sell. Returns the amount sold.
function doSell(res, qty){
    let price = marketSellPrice(res);
    let amount = Math.floor(Math.min(qty, global.resource[res].amount,
      (global.resource.Money.max - global.resource.Money.amount) / price));
    if (amount > 0){
        global.resource[res].amount -= amount;
        global.resource.Money.amount += Math.round(price * amount);
        global.resource[res].value -= Number((amount / Math.rand(1000,10000)).toFixed(2));
        if (global.resource[res].value < Number(resource_values[res] / 2)){
            global.resource[res].value = Number(resource_values[res] / 2);
        }
    }
    return amount;
}

/*********************** Resource classification ***********************/

function isTradable(res){
    return tmp_vars.resource && tmp_vars.resource[res] && tmp_vars.resource[res].tradable
        && global.resource[res] && global.resource[res].display;
}

// A resource can currently be auto-bought: it is a displayed, tradable resource with a real price.
function isBuyable(res){
    if (!isTradable(res)){ return false; }
    if ((global.race['artifical'] || global.race['fasting']) && res === 'Food'){ return false; }
    return global.resource[res].value > 0;
}

// A resource can currently be auto-sold: same as buyable, but also needs a positive storage cap to gauge stock.
function isSellable(res){
    return isBuyable(res) && global.resource[res].max > 0;
}

function tradableResources(){
    if (!tmp_vars.resource){ return []; }
    return Object.keys(tmp_vars.resource).filter(isTradable);
}

/*********************** Price history ***********************/

function recordPrices(){
    tradableResources().forEach(function(res){
        if (!priceHistory[res]){ priceHistory[res] = { buy: [], sell: [] }; }
        let h = priceHistory[res];
        h.buy.push(marketBuyPrice(res));
        h.sell.push(marketSellPrice(res));
        if (h.buy.length > WINDOW){ h.buy.shift(); }
        if (h.sell.length > WINDOW){ h.sell.shift(); }
    });
}

function windowLow(res, kind){
    let h = priceHistory[res];
    if (!h || h[kind].length === 0){ return null; }
    return Math.min.apply(null, h[kind]);
}

function windowHigh(res, kind){
    let h = priceHistory[res];
    if (!h || h[kind].length === 0){ return null; }
    return Math.max.apply(null, h[kind]);
}

/*********************** Building order resolution ***********************/

const deepScan = ['space','interstellar','galaxy','portal','tauceti','eden'];

// Reconstructs the action definition for a build-queue struct (matching main.js queue processing).
// Returns false for unsupported exotic queue entries (ships / mechs).
function queueStructAction(struct){
    if (struct.action === 'tp-ship' || struct.action === 'hell-mech'){
        return false;
    }
    if (deepScan.includes(struct.action)){
        for (let region in actions[struct.action]){
            if (actions[struct.action][region][struct.type]){
                return actions[struct.action][region][struct.type];
            }
        }
        return false;
    }
    if (actions[struct.action] && actions[struct.action][struct.type]){
        return actions[struct.action][struct.type];
    }
    return false;
}

// Among a { res: time } shortage map, returns the tradable resource that takes longest to obtain, or false.
function slowestTradable(shorted){
    let best = false;
    let bestTime = -Infinity;
    Object.keys(shorted).forEach(function(res){
        if (isBuyable(res) && shorted[res] > bestTime){
            bestTime = shorted[res];
            best = res;
        }
    });
    return best;
}

// Returns the slowest-to-obtain tradable resource for the building described by `struct`, or false.
function resolveBuildingTarget(struct){
    try {
        let detail;
        if (struct.action === 'arpa'){
            let t_action = actions.arpa[struct.type];
            if (!t_action){ return false; }
            let complete = global.arpa[struct.type] ? global.arpa[struct.type].complete : 0;
            let remain = (100 - complete) / 100;
            detail = arpaTimeCheck(t_action, remain, false, true);
        }
        else {
            let t_action = queueStructAction(struct);
            if (!t_action){ return false; }
            detail = timeCheck(t_action, false, true);
        }
        return slowestTradable(detail && detail.s ? detail.s : {});
    }
    catch (e){
        return false;
    }
}

// Finds the first build-queue struct matching a given id, or null.
function findQueueStruct(id){
    if (!global.queue || !global.queue.queue){ return null; }
    for (let i=0; i<global.queue.queue.length; i++){
        if (global.queue.queue[i].id === id){
            return global.queue.queue[i];
        }
    }
    return null;
}

/*********************** Tick ***********************/

export function autoMarketTick(){
    if (typeof window !== 'undefined'){ window.__amCalls = (window.__amCalls || 0) + 1; }
    // Throttle to ~once per real second regardless of how many times the mid loop fires this second.
    let now = performance.now();
    if (now - lastTick < TICK_INTERVAL - TICK_TOLERANCE){ return; }
    lastTick = now;
    if (typeof window !== 'undefined'){ window.__amRuns = (window.__amRuns || 0) + 1; }

    if (!tradeAllowed() || !global.resource.Money){ return; }
    if (orderCount() === 0){ return; }

    recordPrices();

    let structureChanged = false;

    // Resolve building orders: retarget to the current slowest resource, or auto-cancel if the
    // building has left the queue (produced with no same-type building following).
    Object.keys(autoMarket.building).forEach(function(id){
        let struct = findQueueStruct(id);
        if (!struct){
            delete autoMarket.building[id];
            structureChanged = true;
            saveOrders();
            return;
        }
        let target = resolveBuildingTarget(struct);
        if (autoMarket.building[id].res !== target){
            autoMarket.building[id].res = target;
            structureChanged = true;
        }
    });

    if (!global.settings.pause){
        let qty = global.city.market.qty > 0 ? global.city.market.qty : 1;

        // Buys: single-resource orders plus each building order's current target.
        let buyTargets = {};
        Object.keys(autoMarket.buy).forEach(function(res){ buyTargets[res] = true; });
        Object.keys(autoMarket.building).forEach(function(id){
            let res = autoMarket.building[id].res;
            if (res){ buyTargets[res] = true; }
        });
        Object.keys(buyTargets).forEach(function(res){
            if (!isBuyable(res)){ return; }
            let low = windowLow(res, 'buy');
            if (low === null){ return; }
            if (marketBuyPrice(res) <= low * BUY_THRESHOLD){
                doPurchase(res, qty);
            }
        });

        // Sells.
        Object.keys(autoMarket.sell).forEach(function(res){
            if (!isSellable(res)){ return; }
            if (global.resource[res].amount < global.resource[res].max * STOCK_THRESHOLD){ return; }
            let high = windowHigh(res, 'sell');
            if (high === null){ return; }
            if (marketSellPrice(res) >= high * SELL_THRESHOLD){
                doSell(res, qty);
            }
        });
    }

    if (structureChanged){
        drawAutoMarket();
    }
}

/*********************** UI ***********************/

function resName(res){
    return global.resource[res] && global.resource[res].name ? global.resource[res].name : res;
}

function priceTip(res, kind){
    if (!res){
        return `<div>${loc('auto_market_no_target')}</div>`;
    }
    let low = windowLow(res, kind);
    let high = windowHigh(res, kind);
    if (low === null || high === null){
        return `<div class="has-text-warning">${resName(res)}</div><div>${loc('auto_market_no_data')}</div>`;
    }
    return `<div class="has-text-warning">${resName(res)}</div>`
        + `<div>${loc('auto_market_low',[sizeApproximation(low,2)])}</div>`
        + `<div>${loc('auto_market_high',[sizeApproximation(high,2)])}</div>`;
}

// Builds the flat list of orders to display, each with a cancel action and a hover tooltip.
function buildOrderList(){
    let list = [];
    Object.keys(autoMarket.buy).forEach(function(res){
        list.push({
            id: `autoOrder-buy-${res}`,
            cls: 'has-text-success',
            text: loc('auto_market_buy_order',[resName(res)]),
            tip: function(){ return priceTip(res, 'buy'); },
            cancel: function(){ delete autoMarket.buy[res]; saveOrders(); drawAutoMarket(); }
        });
    });
    Object.keys(autoMarket.sell).forEach(function(res){
        list.push({
            id: `autoOrder-sell-${res}`,
            cls: 'has-text-danger',
            text: loc('auto_market_sell_order',[resName(res)]),
            tip: function(){ return priceTip(res, 'sell'); },
            cancel: function(){ delete autoMarket.sell[res]; saveOrders(); drawAutoMarket(); }
        });
    });
    Object.keys(autoMarket.building).forEach(function(id){
        let order = autoMarket.building[id];
        let target = order.res ? resName(order.res) : loc('auto_market_pending');
        list.push({
            id: `autoOrder-bld-${id}`,
            cls: 'has-text-caution',
            text: loc('auto_market_building_order',[order.label, target]),
            tip: function(){ return priceTip(order.res, 'buy'); },
            cancel: function(){ delete autoMarket.building[id]; saveOrders(); drawAutoMarket(); }
        });
    });
    return list;
}

export function drawAutoMarket(){
    let el = $('#autoMarket');
    if (el.length === 0){ return; }
    clearElement(el);
    el.empty();

    let orders = buildOrderList();
    if (orders.length === 0){
        el.hide();
        return;
    }
    el.show();

    el.append($(`<h2 class="has-text-success">${loc('auto_market_title')}</h2>`));
    let list = $(`<ul class="autoOrderList"></ul>`);
    el.append(list);

    orders.forEach(function(o){
        let li = $(`<li id="${o.id}" class="autoOrder"><span role="button" class="cancel has-text-danger" aria-label="${loc('auto_market_cancel')}">✖</span> <span class="label ${o.cls}">${o.text}</span></li>`);
        list.append(li);
        li.find('.cancel').on('click', function(){ o.cancel(); });
        popover(o.id, function(){ return $(`<div>${o.tip()}</div>`); }, { placement: 'right' });
    });
}
