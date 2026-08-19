/*
 * Regenerates src/capSources.js from the cap-calculation block inside
 * midLoop() in src/main.js.
 *
 * This exists so that the "why can't I build this?" feature (src/capGraph.js)
 * can answer "which buildings raise the cap of resource X" without patching
 * upstream code. main.js computes every cap imperatively, so the mapping
 * building -> resource only exists as control flow. This script recovers it.
 *
 * Re-run after merging upstream:  node tools/genCapSources.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'main.js');
const OUT = path.join(ROOT, 'src', 'capSources.js');

const SECTORS = ['city','space','interstellar','galaxy','portal','eden','tauceti'];

const lines = fs.readFileSync(SRC, 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('breakdown.c = {};'));
const end = lines.findIndex(l => l.includes('global.resource[res].max = caps[res]'));
if (start < 0 || end < 0 || end <= start){
    console.error('Could not locate the cap block in src/main.js. Upstream layout changed; fix this script.');
    process.exit(1);
}
const seg = lines.slice(start, end + 1);

// Walk the block tracking the stack of enclosing `if (...)` guards by brace depth.
const frames = [];
let depth = 0;
const hits = [];   // { res, guards[], line }
const unresolved = [];

for (let i = 0; i < seg.length; i++){
    const line = seg[i];
    const trimmed = line.trim();

    const guardMatch = trimmed.match(/^(?:\}\s*)?(?:else\s+)?if\s*\((.*)$/);
    const guard = guardMatch ? guardMatch[1] : null;

    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    if (guard){ frames.push({ depth, guard, line: i }); }
    depth += opens - closes;
    while (frames.length && depth <= frames[frames.length - 1].depth && !(guard && frames[frames.length - 1].line === i)){
        frames.pop();
    }

    if (!/^caps[\[\.]/.test(trimmed)) continue;
    const rm = trimmed.match(/^caps(?:\['([^']+)'\]|\.([A-Za-z_0-9]+)|\[([^\]]+)\])/);
    if (!rm) continue;
    // `caps[x] -=` is a drain (psychic channeling), not a source.
    if (/^caps(?:\['[^']+'\]|\.[A-Za-z_0-9]+|\[[^\]]+\])\s*-=/.test(trimmed)) continue;

    const res = rm[1] || rm[2] || rm[3];
    hits.push({ res, guards: frames.map(f => f.guard), line: start + i + 1 });
}

const sectorRe = new RegExp(`global\\.(${SECTORS.join('|')})(?:\\.([A-Za-z_0-9]+)|\\['([A-Za-z_0-9]+)'\\])`, 'g');

const registry = {};   // "sector.struct" -> { res:Set, powered:bool }
const techOnly = {};   // "flag" -> Set(res)   caps granted by a tech with no building

function add(key, res, powered){
    if (!registry[key]) registry[key] = { res: new Set(), powered: false };
    registry[key].res.add(res);
    if (powered) registry[key].powered = true;
}

for (const hit of hits){
    let matched = false;

    // Innermost guard naming a sector struct wins.
    for (let f = hit.guards.length - 1; f >= 0 && !matched; f--){
        const g = hit.guards[f];
        let m;
        sectorRe.lastIndex = 0;
        while ((m = sectorRe.exec(g))){
            const struct = m[2] || m[3];
            if (struct === 'hasOwnProperty') continue;
            add(`${m[1]}.${struct}`, hit.res, /p_on|support_on/.test(g));
            matched = true;
        }
    }
    if (matched) continue;

    // Otherwise a powered-structure guard: p_on['x'] / support_on['x'].
    for (let f = hit.guards.length - 1; f >= 0 && !matched; f--){
        const m = hit.guards[f].match(/(?:p_on|support_on)\['([A-Za-z_0-9]+)'\]/);
        if (m){ add(`?.${m[1]}`, hit.res, true); matched = true; }
    }
    if (matched) continue;

    // Otherwise a bare tech guard: the cap comes from research, not a building.
    for (let f = hit.guards.length - 1; f >= 0 && !matched; f--){
        const m = hit.guards[f].match(/global\.tech\['([A-Za-z_0-9]+)'\]/);
        if (m){
            if (!techOnly[m[1]]) techOnly[m[1]] = new Set();
            techOnly[m[1]].add(hit.res);
            matched = true;
        }
    }
    if (!matched) unresolved.push(hit);
}

// Invert to resource -> sources, which is how capGraph queries it.
const byRes = {};
for (const [key, val] of Object.entries(registry)){
    for (const res of val.res){
        if (!byRes[res]) byRes[res] = [];
        byRes[res].push({ struct: key, powered: val.powered });
    }
}
for (const [flag, set] of Object.entries(techOnly)){
    for (const res of set){
        if (!byRes[res]) byRes[res] = [];
        byRes[res].push({ tech: flag });
    }
}
for (const res of Object.keys(byRes)){
    byRes[res].sort((a, b) => (a.struct || a.tech).localeCompare(b.struct || b.tech));
}

const ordered = {};
for (const res of Object.keys(byRes).sort()) ordered[res] = byRes[res];

const body = Object.entries(ordered).map(([res, list]) => {
    const items = list.map(e => {
        if (e.tech) return `{ tech: '${e.tech}' }`;
        return `{ struct: '${e.struct}'${e.powered ? ', powered: true' : ''} }`;
    });
    return `    '${res}': [\n${items.map(i => '        ' + i).join(',\n')}\n    ]`;
}).join(',\n');

const out = `// GENERATED FILE - do not edit by hand.
// Regenerate with:  node tools/genCapSources.js
//
// Maps a resource to the things that raise its cap, recovered from the cap
// block in midLoop() (src/main.js:${start + 1}-${end + 1}).
//
// struct: '<sector>.<key>' matches global[sector][key]. A sector of '?' means
//   the cap is gated on p_on/support_on and the owning sector could not be
//   determined statically; capGraph resolves those by searching the actions
//   tree for the struct key.
// powered: the cap only applies while the building is powered/supported.
// tech:   the cap comes from research alone, with no building to construct.
//
// 'res' as a resource name is a placeholder for the bulk-storage buildings
// that declare their own resource list; capGraph expands it via action.res().
export const capSources = {
${body}
};

// Cap sources that are not buildings or research and so cannot be acted on by
// constructing something: race traits, shrine bonuses, and the crate/container
// accounting itself. Listed for completeness so the drift check below knows
// they were seen and deliberately skipped.
export const capSourcesUnresolved = ${JSON.stringify(unresolved.map(u => ({ line: u.line, res: u.res, guard: u.guards[u.guards.length - 1] || '' })), null, 4)};
`;

fs.writeFileSync(OUT, out);
console.log(`cap block: src/main.js:${start + 1}-${end + 1}`);
console.log(`cap assignment sites: ${hits.length}`);
console.log(`structs resolved:     ${Object.keys(registry).length}`);
console.log(`tech-only sources:    ${Object.keys(techOnly).length}`);
console.log(`unresolved (non-building): ${unresolved.length}`);
unresolved.forEach(u => console.log(`   main.js:${u.line}  ${u.res}  <- ${u.guards[u.guards.length - 1] || '(top level)'}`));
console.log(`wrote ${path.relative(ROOT, OUT)}`);
