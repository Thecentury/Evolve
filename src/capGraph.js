/*
 * "Why can't I build this?" — capacity blocker explorer.
 *
 * A building can be unbuildable because a resource's *cap* is lower than its
 * cost, and raising that cap usually means constructing some other building,
 * which may itself be cap-blocked or locked behind research. This module walks
 * that chain and renders it.
 *
 * It is deliberately additive: the resource -> cap-source mapping lives in the
 * generated ./capSources.js, and the only upstream hooks are a small button in
 * addAction() plus the import of this file from main.js.
 */
import { global, sizeApproximation } from './vars.js';
import { loc } from './locale.js';
import { actions, checkAffordable, storageMultipler } from './actions.js';
import { adjustCosts } from './functions.js';
import { spatialReasoning, crateValue, containerValue } from './resources.js';
import { tpStorageMultiplier } from './truepath.js';
import { capSources } from './capSources.js';

const SECTORS = ['city','space','interstellar','galaxy','portal','eden','tauceti'];

// Cost keys that are not stockpiled resources and so can never be cap-blocked.
const NON_RESOURCE_COSTS = new Set(['Custom','Structs','Bool','Morale','Army','HellArmy','Troops','Supply']);

const MAX_DEPTH = 2;

// A source that needs a research chain this long is not an answer to "what do
// I build next", it is the rest of the game. Kept only if nothing else exists.
const FAR_CHAIN = 8;
// How many alternatives are worth showing before the list stops being advice.
const MAX_OPTIONS = [8, 4, 3];
// How many of those get their own blockers unfolded.
const EXPAND = 2;
// How many of one building's own cap blockers to follow.
const MAX_SUB_BLOCKERS = 3;

/* ------------------------------------------------------------------ *
 * Struct index
 * ------------------------------------------------------------------ */

let structIndex = null;   // 'sector.key' -> entry
let structByKey = null;   // 'key'        -> [entry]

function indexEntry(sector, key, action, group){
    const entry = { sector, key, action, group, path: `${sector}.${key}` };
    structIndex[entry.path] = entry;
    (structByKey[key] = structByKey[key] || []).push(entry);
}

function buildIndex(){
    if (structIndex){ return; }
    structIndex = {};
    structByKey = {};
    for (const sector of SECTORS){
        const tree = actions[sector];
        if (!tree){ continue; }
        for (const key of Object.keys(tree)){
            const node = tree[key];
            if (!node || typeof node !== 'object'){ continue; }
            if (node.id){
                indexEntry(sector, key, node);
            }
            else {
                // Region grouping, e.g. actions.space.spc_red.garage
                for (const sub of Object.keys(node)){
                    if (sub === 'info'){ continue; }
                    const leaf = node[sub];
                    if (leaf && typeof leaf === 'object' && leaf.id){
                        indexEntry(sector, sub, leaf, key);
                    }
                }
            }
        }
    }
}

// capSources uses '?.<key>' when the owning sector could not be determined
// statically (the cap was gated on p_on[...] alone).
function resolveSource(spec){
    buildIndex();
    if (spec.tech){ return null; }
    if (spec.struct.startsWith('?.')){
        const key = spec.struct.slice(2);
        const hits = structByKey[key];
        if (!hits || hits.length === 0){ return null; }
        // Prefer one that already exists in the save, else the first match.
        return hits.find(e => global[e.sector] && global[e.sector].hasOwnProperty(e.key)) || hits[0];
    }
    return structIndex[spec.struct] || null;
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function titleOf(action){
    if (!action){ return '?'; }
    try { return typeof action.title === 'string' ? action.title : action.title(); }
    catch (e){ return '?'; }
}

function effectOf(action){
    if (!action || !action.effect){ return ''; }
    try {
        const html = typeof action.effect === 'string' ? action.effect : action.effect();
        return typeof html === 'string' ? html : '';
    }
    catch (e){ return ''; }
}

function regionLabel(entry){
    if (!entry.group){ return ''; }
    const group = actions[entry.sector] && actions[entry.sector][entry.group];
    const info = group && group.info;
    if (!info || !info.name){ return ''; }
    try { return typeof info.name === 'string' ? info.name : info.name(); }
    catch (e){ return ''; }
}

function resName(res){
    return global.resource[res] && global.resource[res].name ? global.resource[res].name : res;
}

function fmt(v){
    return sizeApproximation(v, 1);
}

function esc(str){
    return String(str).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]);
}

// capSources stores the population cap under the literal source expression.
function normRes(res){
    return res === 'global.race.species' ? global.race.species : res;
}

// Would this building ever be offered in the current run?
function plausible(action){
    if (!action){ return false; }
    if (action.path){
        const cPath = global.race['truepath'] ? 'truepath' : 'standard';
        if (!action.path.includes(cPath)){ return false; }
    }
    if (action.trait && !action.trait.every(t => global.race[t])){ return false; }
    if (action.not_trait && action.not_trait.some(t => global.race[t])){ return false; }
    return true;
}

// A building is offerable once its tech requirements are met; the struct only
// appears in `global` after the first one is actually constructed.
function techMet(action){
    if (!action || !action.reqs){ return true; }
    return Object.keys(action.reqs).every(r => (global.tech[r] || 0) >= action.reqs[r]);
}

function isUnlocked(entry){
    if (global[entry.sector] && global[entry.sector].hasOwnProperty(entry.key)){ return true; }
    return techMet(entry.action);
}

function countOf(entry){
    const s = global[entry.sector] && global[entry.sector][entry.key];
    return s && typeof s.count === 'number' ? s.count : 0;
}

/* ------------------------------------------------------------------ *
 * Per-unit cap gain
 *
 * Only the bulk-storage buildings declare their storage table (res()/val())
 * on the action, so those are the ones we can put an exact number against.
 * The multiplier arithmetic mirrors the cap block in main.js; if that block
 * changes upstream these become approximations, never wrong answers about
 * *which* building to build.
 * ------------------------------------------------------------------ */

const BULK_GAIN = {
    'city.shed':              (a, res) => spatialReasoning(a.val(res) * storageMultipler()),
    'interstellar.warehouse': (a, res) => spatialReasoning(a.val(res) * storageMultipler()),
    'portal.warehouse':       (a, res) => spatialReasoning(a.val(res) * storageMultipler()),
    'eden.warehouse':         (a, res) => spatialReasoning(a.val(res) * storageMultipler(global.race['warlord'] ? 1 : 0.2)),
    'space.garage':           (a, res) => spatialReasoning(a.val(res) * a.multiplier(a.heavy(res))),
    'space.storehouse':       (a, res) => spatialReasoning(a.val(res) * tpStorageMultiplier('storehouse', a.heavy(res))),
    'tauceti.repository':     (a, res) => spatialReasoning(a.val(res) * tpStorageMultiplier('repository')),
    'portal.harbor':          (a, res) => spatialReasoning(a.val(res))
};

function perUnitGain(entry, res){
    const fn = BULK_GAIN[entry.path];
    if (!fn){ return null; }
    try {
        const list = entry.action.res();
        if (!list.includes(res)){ return null; }
        const gain = fn(entry.action, res);
        return gain > 0 ? gain : null;
    }
    catch (e){ return null; }
}

// Does this source raise the cap of `res` at all?
function sourcesFor(res){
    const out = [];
    const seen = new Set();
    const push = (spec) => {
        const entry = resolveSource(spec);
        if (!entry || seen.has(entry.path)){ return; }
        if (!plausible(entry.action)){ return; }
        seen.add(entry.path);
        out.push({ entry, powered: !!spec.powered });
    };

    (capSources[res] || []).forEach(spec => { if (!spec.tech){ push(spec); } });

    // The bulk-storage buildings are registered under the 'res' placeholder;
    // ask each one whether it actually stores this resource right now.
    (capSources['res'] || []).forEach(spec => {
        const entry = resolveSource(spec);
        if (!entry || !entry.action.res){ return; }
        try { if (!entry.action.res().includes(res)){ return; } }
        catch (e){ return; }
        push(spec);
    });

    return out;
}

/* ------------------------------------------------------------------ *
 * Tech chain
 * ------------------------------------------------------------------ */

let grantIndex = null;
function addGrant(key, action, kind){
    if (!action.grant || typeof action.grant[1] !== 'number'){ return; }
    const flag = action.grant[0];
    (grantIndex[flag] = grantIndex[flag] || []).push({ key, level: action.grant[1], action, kind });
}

// Not every unlock is a tech: region access comes from missions declared on
// the sector actions, so both go in the same index.
function buildGrantIndex(){
    if (grantIndex){ return; }
    grantIndex = {};
    for (const key of Object.keys(actions.tech)){
        addGrant(key, actions.tech[key], 'tech');
    }
    buildIndex();
    for (const path of Object.keys(structIndex)){
        addGrant(structIndex[path].key, structIndex[path].action, 'action');
    }
    for (const flag of Object.keys(grantIndex)){
        grantIndex[flag].sort((a, b) => a.level - b.level);
    }
}

// Every tech that still has to be researched to satisfy `reqs`, in order.
function techChain(reqs, acc, seen){
    acc = acc || [];
    seen = seen || new Set();
    if (!reqs){ return acc; }
    buildGrantIndex();
    for (const flag of Object.keys(reqs)){
        const have = global.tech[flag] || 0;
        const want = reqs[flag];
        if (have >= want){ continue; }
        const grants = grantIndex[flag] || [];
        for (const g of grants){
            if (g.level <= have || g.level > want){ continue; }
            if (seen.has(g.key)){ continue; }
            seen.add(g.key);
            techChain(g.action.reqs, acc, seen);
            acc.push(g);
        }
    }
    return acc;
}

function techKnowledgeBlock(techAction){
    if (!techAction.cost || !techAction.cost.Knowledge){ return null; }
    let need;
    try { need = Number(techAction.cost.Knowledge()) || 0; }
    catch (e){ return null; }
    const cap = Number(global.resource.Knowledge.max);
    return (cap >= 0 && need > cap) ? { res: 'Knowledge', need, cap } : null;
}

/* ------------------------------------------------------------------ *
 * Blocker analysis
 * ------------------------------------------------------------------ */

export function capBlockers(c_action){
    if (!c_action || !c_action.cost){ return []; }
    let costs;
    try { costs = adjustCosts(c_action); }
    catch (e){ return []; }

    const out = [];
    for (const res of Object.keys(costs)){
        if (NON_RESOURCE_COSTS.has(res)){ continue; }
        if (global.prestige && global.prestige.hasOwnProperty(res)){ continue; }
        const target = res === 'Species' ? global.race.species : res;
        const r = global.resource[target];
        if (!r){ continue; }
        let need;
        try { need = Number(costs[res]()) || 0; }
        catch (e){ continue; }
        if (need <= 0){ continue; }
        const cap = Number(r.max);
        if (cap >= 0 && need > cap){
            out.push({ res: target, need, cap });
        }
    }
    return out;
}

function crateOptions(res, deficit, depth){
    const out = [];
    const r = global.resource[res];
    if (!r || !r.hasOwnProperty('crates')){ return out; }

    if (global.resource.Crates && global.resource.Crates.display){
        const per = crateValue();
        out.push({
            kind: 'crate',
            title: loc('resource_Crates_plural'),
            per,
            need: Math.ceil(deficit / per),
            free: global.resource.Crates.amount,
            slots: global.resource.Crates.max,
            assigned: r.crates
        });
    }
    if (global.resource.Containers && global.resource.Containers.display && r.hasOwnProperty('containers')){
        const per = containerValue();
        out.push({
            kind: 'container',
            title: loc('resource_Containers_plural'),
            per,
            need: Math.ceil(deficit / per),
            free: global.resource.Containers.amount,
            slots: global.resource.Containers.max,
            assigned: r.containers
        });
    }
    // Deeper in the tree, an option the player owns none of and has nowhere to
    // put is noise; at the top level it still tells them crates are a lever.
    return depth > 0 ? out.filter(o => o.free > 0 || o.slots > 0) : out;
}

// Build the option tree for "cap of `res` needs to reach `need`".
function planForResource(res, need, cap, depth, seen){
    const deficit = Math.max(0, need - cap);
    const plan = { res, need, cap, deficit, crates: [], builds: [], techs: [], truncated: false, hidden: 0 };

    if (depth > MAX_DEPTH){
        plan.truncated = true;
        return plan;
    }

    plan.crates = crateOptions(res, deficit, depth);

    (capSources[res] || []).forEach(spec => {
        if (!spec.tech){ return; }
        if ((global.tech[spec.tech] || 0) > 0){ return; }
        plan.techs.push(spec.tech);
    });

    for (const src of sourcesFor(res)){
        const entry = src.entry;
        if (seen.has(entry.path)){ continue; }
        const node = describeBuild(entry, src.powered, res, deficit);
        // The cap we are already solving is not news as one of its blockers.
        if (node.subBlockers){
            node.subBlockers = node.subBlockers.filter(b => !seen.has('res:' + b.res));
        }
        plan.builds.push(node);
    }

    // Buildable-now first, then unlocked, then the shortest research chains.
    const rank = { ready: 0, 'need-res': 1, 'need-cap': 2, 'need-tech': 3 };
    plan.builds.sort((a, b) => (rank[a.status] - rank[b.status]) || (a.chain.length - b.chain.length));

    // Anything behind a very long research chain is noise unless it is all
    // that is left.
    const near = plan.builds.filter(b => b.chain.length <= FAR_CHAIN);
    if (near.length > 0){
        plan.hidden = plan.builds.length - near.length;
        plan.builds = near;
    }
    else if (plan.builds.length > 1){
        plan.hidden = plan.builds.length - 1;
        plan.builds = plan.builds.slice(0, 1);
    }

    const limit = MAX_OPTIONS[Math.min(depth, MAX_OPTIONS.length - 1)];
    if (plan.builds.length > limit){
        plan.hidden = (plan.hidden || 0) + (plan.builds.length - limit);
        plan.builds = plan.builds.slice(0, limit);
    }

    // If something here can already be acted on, that is the answer, and what
    // sits behind the other options is irrelevant. Only when every option is
    // itself blocked is the chain worth unfolding — which is exactly the case
    // this whole view exists for.
    const actionable = plan.builds.some(b => b.status === 'ready' || b.status === 'need-res')
        || plan.crates.some(c => c.free >= c.need);
    if (!actionable){
        plan.builds
            .filter(node => node.status === 'need-cap' || node.status === 'need-tech')
            .slice(0, EXPAND)
            .forEach(node => expandBuild(node, depth, seen));
    }

    // Crate/container assignment is only useful advice when the crates exist.
    plan.crates.sort((a, b) => (b.free >= b.need ? 1 : 0) - (a.free >= a.need ? 1 : 0));

    return plan;
}

// Phase 1: what is this building and what stands in its way. Cheap.
function describeBuild(entry, powered, res, deficit){
    const action = entry.action;
    const node = {
        kind: 'build',
        entry,
        path: entry.path,
        title: titleOf(action),
        region: regionLabel(entry),
        effect: effectOf(action),
        powered,
        count: countOf(entry),
        unlocked: isUnlocked(entry),
        chain: [],
        blockers: [],
        status: 'ready',
        needCount: null
    };

    const per = perUnitGain(entry, res);
    if (per){
        node.per = per;
        node.needCount = Math.ceil(deficit / per);
    }

    if (!node.unlocked){
        node.status = 'need-tech';
        node.chain = techChain(action.reqs).map(g => ({
            key: g.key,
            kind: g.kind,
            title: titleOf(g.action),
            knowledge: g.kind === 'tech' ? techKnowledgeBlock(g.action) : null
        }));
    }
    else if (checkAffordable(action)){
        node.status = 'ready';
    }
    else if (checkAffordable(action, true)){
        node.status = 'need-res';
    }
    else {
        node.status = 'need-cap';
        node.subBlockers = capBlockers(action);
    }
    return node;
}

// Phase 2: recurse, but only for the options actually being recommended.
function expandBuild(node, depth, seen){
    const nextSeen = new Set(seen);
    nextSeen.add(node.path);

    if (node.status === 'need-tech'){
        // A research cost the Knowledge cap cannot hold is itself a cap problem.
        const kBlock = node.chain.map(t => t.knowledge).filter(Boolean).sort((a, b) => b.need - a.need)[0];
        if (kBlock && !nextSeen.has('res:Knowledge')){
            nextSeen.add('res:Knowledge');
            node.blockers.push(planForResource('Knowledge', kBlock.need, kBlock.cap, depth + 1, nextSeen));
        }
        return;
    }

    if (node.status !== 'need-cap'){ return; }
    const subs = (node.subBlockers || []).filter(b => !nextSeen.has('res:' + b.res));
    node.hiddenBlockers = Math.max(0, subs.length - MAX_SUB_BLOCKERS);
    for (const b of subs.slice(0, MAX_SUB_BLOCKERS)){
        const bSeen = new Set(nextSeen);
        bSeen.add('res:' + b.res);
        node.blockers.push(planForResource(b.res, b.need, b.cap, depth + 1, bSeen));
    }
}

export function analyze(c_action){
    buildIndex();
    return capBlockers(c_action).map(b => {
        const seen = new Set(['res:' + b.res]);
        return planForResource(b.res, b.need, b.cap, 0, seen);
    });
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const STATUS_LABEL = {
    'ready':     ['cgOk',   'can build now'],
    'need-res':  ['cgWarn', 'affordable eventually — just needs resources'],
    'need-cap':  ['cgBad',  'blocked by another cap'],
    'need-tech': ['cgLock', 'locked']
};

function renderCrate(opt){
    const enough = opt.free >= opt.need;
    const bits = [];
    bits.push(`<b>${opt.need}</b> &times; ${esc(opt.title)}`);
    bits.push(`+${fmt(opt.per)} each`);
    bits.push(`${opt.free} spare, ${opt.assigned} already here`);
    return `<div class="cgNode ${enough ? 'cg-ready' : 'cg-need-res'}">
        <div class="cgRow">
            <span class="cgDot"></span>
            <span class="cgName">${esc(opt.title)}</span>
            <span class="cgStatus ${enough ? 'cgOk' : 'cgWarn'}">${enough ? 'available now' : 'build more first'}</span>
        </div>
        <div class="cgEffect">${bits.join(' &middot; ')}</div>
    </div>`;
}

const CHAIN_SHOWN = 4;

function renderChain(chain){
    if (chain.length === 0){ return ''; }
    const shown = chain.slice(0, CHAIN_SHOWN);
    let names = shown.map(t => `<span class="${t.kind === 'tech' ? 'cgTech' : 'cgMission'}">${esc(t.title)}</span>`).join('<span class="cgArrow">&rarr;</span>');
    if (chain.length > shown.length){
        names += `<span class="cgArrow">&rarr;</span><span class="cgMore">${chain.length - shown.length} more</span>`;
    }
    const label = chain.every(t => t.kind === 'tech') ? 'research' : 'unlock via';
    return `<div class="cgChain"><span class="cgChainLabel">${label}</span>${names}</div>`;
}

function renderBuild(node, depth){
    const [cls, label] = STATUS_LABEL[node.status] || ['', ''];
    const meta = [];
    if (node.count > 0){ meta.push(`${node.count} built`); }
    if (node.powered){ meta.push('must be powered'); }

    let effect = '';
    if (node.needCount !== null){
        effect = `+${fmt(node.per)} each &rarr; <b>build ${node.needCount} more</b>`;
    }
    else if (node.effect){
        effect = node.effect;
    }

    let kids = '';
    if (node.status === 'need-tech'){
        kids += renderChain(node.chain);
    }
    for (const plan of node.blockers){
        kids += renderPlan(plan, depth + 1);
    }
    if (node.status === 'need-cap' && node.blockers.length === 0 && node.subBlockers){
        const names = node.subBlockers.map(b => esc(resName(b.res))).join(', ');
        kids += `<div class="cgNote">blocked by: ${names}</div>`;
    }
    if (node.hiddenBlockers > 0){
        kids += `<div class="cgNote">and ${node.hiddenBlockers} further cap${node.hiddenBlockers === 1 ? '' : 's'}</div>`;
    }

    return `<div class="cgNode cg-${node.status}">
        <div class="cgRow">
            <span class="cgDot"></span>
            <span class="cgName">${esc(node.title)}</span>
            ${node.region ? `<span class="cgRegion">${esc(node.region)}</span>` : ''}
            ${meta.length ? `<span class="cgMeta">${esc(meta.join(' &middot; ').replace(/&amp;middot;/g, '&middot;'))}</span>` : ''}
            <span class="cgStatus ${cls}">${label}</span>
        </div>
        ${effect ? `<div class="cgEffect">${effect}</div>` : ''}
        ${kids ? `<div class="cgKids">${kids}</div>` : ''}
    </div>`;
}

function bestAdvice(plan){
    for (const c of plan.crates){
        if (c.free >= c.need){
            return `Assign <b>${c.need}</b> ${esc(c.title)} &mdash; you have ${c.free} spare.`;
        }
    }
    const counted = plan.builds.find(b => b.needCount !== null && (b.status === 'ready' || b.status === 'need-res'));
    if (counted){
        const verb = counted.status === 'ready' ? 'Build' : 'Save up and build';
        return `${verb} <b>${counted.needCount}</b> more &times; <b>${esc(counted.title)}</b>.`;
    }
    const ready = plan.builds.find(b => b.status === 'ready');
    if (ready){
        return `Build more <b>${esc(ready.title)}</b>.`;
    }
    const soon = plan.builds.find(b => b.status === 'need-res');
    if (soon){
        return `Save up for <b>${esc(soon.title)}</b> &mdash; nothing else is in the way.`;
    }
    const locked = plan.builds.find(b => b.status === 'need-tech' && b.chain.length > 0);
    if (locked){
        return `Nothing available yet. Shortest unlock: <b>${esc(locked.title)}</b> via ${locked.chain.length} research step${locked.chain.length === 1 ? '' : 's'}.`;
    }
    return `No construction raises this cap in the current run.`;
}

function renderPlan(plan, depth){
    depth = depth || 0;
    const head = depth === 0
        ? `<div class="cgHead">
               <span class="cgResName">${esc(resName(plan.res))}</span>
               cap <b>${fmt(plan.cap)}</b> &middot; need <b>${fmt(plan.need)}</b> &middot;
               short by <b class="cgBad">${fmt(plan.deficit)}</b>
           </div>
           <div class="cgAdvice">${bestAdvice(plan)}</div>`
        : `<div class="cgSubHead">needs <span class="cgResName">${esc(resName(plan.res))}</span>
               cap raised from <b>${fmt(plan.cap)}</b> to <b>${fmt(plan.need)}</b></div>`;

    if (plan.truncated){
        return `${head}<div class="cgNote">chain continues &mdash; open this building's own explainer to go deeper</div>`;
    }

    const opts = [];
    plan.crates.filter(c => c.free >= c.need).forEach(c => opts.push(renderCrate(c)));
    plan.builds.forEach(b => opts.push(renderBuild(b, depth)));
    plan.crates.filter(c => c.free < c.need).forEach(c => opts.push(renderCrate(c)));
    plan.techs.forEach(t => opts.push(`<div class="cgNode cg-need-tech">
        <div class="cgRow"><span class="cgDot"></span><span class="cgName">${esc(t)}</span>
        <span class="cgStatus cgLock">research only &mdash; no building</span></div></div>`));

    const more = plan.hidden > 0
        ? `<div class="cgNote">${plan.hidden} further source${plan.hidden === 1 ? ' exists' : 's exist'} much later in the game.</div>`
        : '';
    const body = opts.length
        ? `<div class="cgGroup">${depth === 0 ? '<div class="cgGroupLabel">any one of these raises it</div>' : ''}${opts.join('')}${more}</div>`
        : `<div class="cgNote">Nothing in the current run raises this cap.</div>`;

    return head + body;
}

function renderModal(c_action, plans){
    if (plans.length === 0){
        return `<div class="cgNote">${esc(titleOf(c_action))} is not blocked by any resource cap right now.</div>`;
    }

    const tabs = plans.map((p, i) =>
        `<li class="cgTab${i === 0 ? ' is-active' : ''}" data-cg-tab="${i}"><a>${esc(resName(p.res))}</a></li>`
    ).join('');

    const panes = plans.map((p, i) =>
        `<div class="cgPane${i === 0 ? '' : ' cgHidden'}" data-cg-pane="${i}">${renderPlan(p, 0)}</div>`
    ).join('');

    return `<div class="cgTabs"><ul>${tabs}</ul></div><div class="cgPanes">${panes}</div>`;
}

/* ------------------------------------------------------------------ *
 * Modal plumbing
 * ------------------------------------------------------------------ */

let capVue = null;
function capHost(){
    if (capVue){ return capVue; }
    if ($('#capGraphAnchor').length === 0){
        $('body').append('<div id="capGraphAnchor"></div>');
    }
    capVue = new Vue({ el: '#capGraphAnchor' });
    return capVue;
}

export function openCapModal(sector, key){
    buildIndex();
    const entry = structIndex[`${sector}.${key}`]
        || (structByKey[key] && structByKey[key][0])
        || (actions[sector] && actions[sector][key] ? { sector, key, action: actions[sector][key] } : null);
    if (!entry){ return; }

    const c_action = entry.action;
    const plans = analyze(c_action);
    const host = capHost();
    const modal = { template: '<div id="modalBox" class="modalBox"></div>' };

    host.$buefy.modal.open({ parent: host, component: modal });

    const check = setInterval(function(){
        if ($('#modalBox').length === 0){ return; }
        clearInterval(check);
        $('#modalBox').append(`<p id="modalBoxTitle" class="has-text-warning modalTitle">${esc(titleOf(c_action))} &mdash; capacity blockers</p>`);
        const body = $('<div id="capGraphModal" class="modalBody"></div>');
        body.html(renderModal(c_action, plans));
        $('#modalBox').append(body);
    }, 50);
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

const CSS = `
.action > .capBlock { position:absolute; top:.5rem; left:0; width:1.1875rem; height:1.125rem;
    line-height:1rem; text-align:center; font-size:.75rem; font-weight:bold; cursor:pointer;
    display:block; overflow:hidden; border-radius:.25rem 0 .4375rem 0;
    background:var(--cg-chip-bg, rgba(0,0,0,.35)); border:.0625rem solid #b1676b; color:#b1676b; }
.action > .capBlock:hover { border-color:#f57373; color:#f57373; }
.action > .special ~ .capBlock { left:1.25rem; border-radius:0; }
/* the gear is toggled with an inline style, so reclaim the corner when it is hidden */
.action > .special[style*="none"] ~ .capBlock { left:0; border-radius:.25rem 0 .4375rem 0; }
.action:not(.cnam) > .capBlock { display:none; }

#capGraphModal { max-height:70vh; overflow-y:auto; padding:.5rem .75rem; text-align:left; }
#capGraphModal .cgTabs ul { display:flex; flex-wrap:wrap; border-bottom:.0625rem solid #555; margin-bottom:.5rem; }
#capGraphModal .cgTab { padding:.25rem .75rem; cursor:pointer; border-bottom:.125rem solid transparent; }
#capGraphModal .cgTab.is-active { border-bottom-color:#ffd700; }
#capGraphModal .cgTab.is-active a { color:#ffd700; }
#capGraphModal .cgHidden { display:none; }
#capGraphModal .cgHead { font-size:1rem; margin-bottom:.25rem; }
#capGraphModal .cgSubHead { font-size:.8125rem; margin:.25rem 0; opacity:.85; }
#capGraphModal .cgResName { color:#ffd700; font-weight:bold; }
#capGraphModal .cgAdvice { margin:.25rem 0 .75rem; padding:.375rem .5rem; border-left:.1875rem solid #7fbf7f; background:rgba(127,191,127,.08); }
#capGraphModal .cgGroupLabel { font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; opacity:.6; margin:.25rem 0; }
#capGraphModal .cgNode { position:relative; margin:.25rem 0 .25rem .25rem; padding:.25rem 0 .25rem .75rem; border-left:.125rem solid #444; }
#capGraphModal .cgNode.cg-ready { border-left-color:#7fbf7f; }
#capGraphModal .cgNode.cg-need-res { border-left-color:#d1c07a; }
#capGraphModal .cgNode.cg-need-cap { border-left-color:#d18f4a; }
#capGraphModal .cgNode.cg-need-tech { border-left-color:#6f8fbf; }
#capGraphModal .cgDot { position:absolute; left:-.3125rem; top:.625rem; width:.5rem; height:.5rem;
    border-radius:50%; background:#444; }
#capGraphModal .cg-ready > .cgRow > .cgDot { background:#7fbf7f; }
#capGraphModal .cg-need-res > .cgRow > .cgDot { background:#d1c07a; }
#capGraphModal .cg-need-cap > .cgRow > .cgDot { background:#d18f4a; }
#capGraphModal .cg-need-tech > .cgRow > .cgDot { background:#6f8fbf; }
#capGraphModal .cgName { font-weight:bold; }
#capGraphModal .cgMeta, #capGraphModal .cgStatus { font-size:.75rem; margin-left:.5rem; opacity:.8; }
#capGraphModal .cgRegion { font-size:.6875rem; margin-left:.375rem; opacity:.55; font-style:italic; }
#capGraphModal .cgOk { color:#7fbf7f; }
#capGraphModal .cgWarn { color:#d1c07a; }
#capGraphModal .cgBad { color:#d18f4a; }
#capGraphModal .cgLock { color:#6f8fbf; }
#capGraphModal .cgEffect { font-size:.8125rem; opacity:.9; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
#capGraphModal .cgEffect div { display:inline-block; margin-right:.625rem; }
#capGraphModal .cgMore { opacity:.6; font-style:italic; }
#capGraphModal .cgChain { font-size:.8125rem; margin:.25rem 0; }
#capGraphModal .cgChainLabel { font-size:.6875rem; text-transform:uppercase; opacity:.6; margin-right:.375rem; }
#capGraphModal .cgTech { color:#6f8fbf; }
#capGraphModal .cgMission { color:#a98fbf; }
#capGraphModal .cgArrow { opacity:.5; margin:0 .25rem; }
#capGraphModal .cgKids { margin-top:.375rem; }
#capGraphModal .cgNote { font-size:.8125rem; opacity:.7; padding:.25rem 0; }
`;

function injectCss(){
    if (document.getElementById('capGraphCss')){ return; }
    const style = document.createElement('style');
    style.id = 'capGraphCss';
    style.textContent = CSS;
    document.head.appendChild(style);
}

// Delegated so the handler survives every redraw of the action buttons.
function attach(){
    injectCss();
    // Handy from the console, and what the smoke check in tools/ drives.
    window.capGraph = { analyze, openCapModal, capBlockers };
    $(document).on('click', '.capBlock', function(e){
        e.preventDefault();
        e.stopPropagation();
        openCapModal($(this).attr('data-cg-sector'), $(this).attr('data-cg-key'));
    });
    $(document).on('click', '#capGraphModal .cgTab', function(){
        const idx = $(this).attr('data-cg-tab');
        $('#capGraphModal .cgTab').removeClass('is-active');
        $(this).addClass('is-active');
        $('#capGraphModal .cgPane').addClass('cgHidden');
        $(`#capGraphModal .cgPane[data-cg-pane="${idx}"]`).removeClass('cgHidden');
    });
}

if (typeof document !== 'undefined'){
    if (document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', attach);
    }
    else {
        attach();
    }
}
