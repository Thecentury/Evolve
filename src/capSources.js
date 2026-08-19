// GENERATED FILE - do not edit by hand.
// Regenerate with:  node tools/genCapSources.js
//
// Maps a resource to the things that raise its cap, recovered from the cap
// block in midLoop() (src/main.js:8328-10363).
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
    'Asphodel_Powder': [
        { struct: 'eden.encampment', powered: true }
    ],
    'Authority': [
        { struct: 'city.garrison' },
        { struct: 'city.temple' },
        { struct: 'eden.bunker', powered: true },
        { struct: 'interstellar.cruiser' },
        { tech: 'isolation' },
        { struct: 'portal.brute' },
        { struct: 'portal.minions' },
        { tech: 'primitive' },
        { struct: 'space.space_barracks' }
    ],
    'Chrysotile': [
        { struct: 'city.rock_quarry' }
    ],
    'Cipher': [
        { struct: 'space.zero_g_lab', powered: true },
        { struct: 'tauceti.alien_outpost' }
    ],
    'Containers': [
        { struct: '?.arcology', powered: true },
        { struct: '?.colony', powered: true },
        { struct: 'city.warehouse' },
        { struct: 'city.wharf' },
        { struct: 'galaxy.gateway_depot' },
        { struct: 'interstellar.cargo_yard' },
        { struct: 'portal.bazaar' },
        { struct: 'portal.spire' },
        { struct: 'portal.warehouse' },
        { struct: 'space.garage' },
        { struct: 'space.munitions_depot' },
        { struct: 'tauceti.repository' },
        { tech: 'tp_depot' }
    ],
    'Crates': [
        { struct: '?.arcology', powered: true },
        { struct: '?.colony', powered: true },
        { struct: 'city.storage_yard' },
        { struct: 'city.wharf' },
        { struct: 'galaxy.gateway_depot' },
        { struct: 'interstellar.cargo_yard' },
        { struct: 'portal.bazaar' },
        { struct: 'portal.spire' },
        { struct: 'portal.warehouse' },
        { struct: 'space.garage' },
        { struct: 'space.munitions_depot' },
        { struct: 'tauceti.repository' },
        { tech: 'tp_depot' }
    ],
    'Deuterium': [
        { struct: '?.nexus', powered: true },
        { struct: '?.xfer_station', powered: true },
        { struct: 'galaxy.gateway_station', powered: true }
    ],
    'Elerium': [
        { struct: '?.corruptor', powered: true },
        { struct: '?.elerium_contain', powered: true },
        { struct: '?.elerium_containment', powered: true },
        { struct: '?.exotic_lab', powered: true },
        { struct: '?.nexus', powered: true },
        { struct: '?.shadow_mine', powered: true },
        { struct: '?.space_station', powered: true },
        { struct: 'galaxy.gateway_depot' },
        { struct: 'galaxy.gateway_station', powered: true },
        { struct: 'tauceti.infectious_disease_lab' }
    ],
    'Food': [
        { struct: '?.biodome', powered: true },
        { struct: '?.tau_farm', powered: true },
        { struct: '?.transmitter', powered: true },
        { struct: 'city.compost' },
        { struct: 'city.silo' },
        { struct: 'city.smokehouse' },
        { struct: 'city.soul_well' },
        { struct: 'city.wardenclyffe' }
    ],
    'Helium_3': [
        { struct: '?.nexus', powered: true },
        { struct: '?.orbital_station', powered: true },
        { struct: '?.refueling_station', powered: true },
        { struct: '?.xfer_station', powered: true },
        { struct: 'city.oil_depot' },
        { struct: 'galaxy.gateway_station', powered: true },
        { struct: 'portal.pumpjack' },
        { struct: 'space.gas_storage' },
        { struct: 'space.helium_mine' },
        { struct: 'space.propellant_depot' }
    ],
    'Infernite': [
        { struct: 'galaxy.gateway_depot' },
        { struct: 'interstellar.cargo_yard' },
        { struct: 'portal.fortress' }
    ],
    'Iridium': [
        { struct: '?.moon_base', powered: true }
    ],
    'Knowledge': [
        { struct: '?.alien_outpost', powered: true },
        { struct: '?.decoder', powered: true },
        { struct: '?.exotic_lab', powered: true },
        { struct: '?.research_station', powered: true },
        { struct: '?.s_gate', powered: true },
        { struct: '?.world_controller', powered: true },
        { struct: 'city.biolab' },
        { struct: 'city.library' },
        { struct: 'city.university' },
        { struct: 'city.wardenclyffe' },
        { struct: 'galaxy.symposium', powered: true },
        { struct: 'interstellar.laboratory' },
        { struct: 'portal.archaeology' },
        { struct: 'portal.sensor_drone' },
        { struct: 'portal.twisted_lab' },
        { struct: 'space.observatory' },
        { struct: 'space.satellite' },
        { struct: 'space.zero_g_lab', powered: true },
        { struct: 'tauceti.infectious_disease_lab' },
        { struct: 'tauceti.overseer' }
    ],
    'Lumber': [
        { struct: 'city.graveyard' },
        { struct: 'city.lumber_yard' },
        { struct: 'city.sawmill' }
    ],
    'Mana': [
        { struct: 'city.pylon' },
        { struct: 'city.wardenclyffe' },
        { struct: 'interstellar.laboratory' },
        { struct: 'space.pylon' },
        { struct: 'tauceti.pylon' }
    ],
    'Materials': [
        { struct: 'tauceti.mining_pit' }
    ],
    'Money': [
        { struct: '?.arcology', powered: true },
        { tech: 'banking' },
        { struct: 'city.apartment' },
        { struct: 'city.bank', powered: true },
        { struct: 'city.casino' },
        { struct: 'city.cottage' },
        { struct: 'eden.eternal_bank' },
        { struct: 'galaxy.resort' },
        { struct: 'interstellar.exchange' },
        { struct: 'interstellar.luxury_condo', powered: true },
        { struct: 'portal.bazaar' },
        { struct: 'portal.hell_casino' },
        { struct: 'portal.spire' },
        { struct: 'space.living_quarters' },
        { struct: 'space.spc_casino' },
        { struct: 'space.titan_bank' },
        { struct: 'tauceti.colony' },
        { struct: 'tauceti.tauceti_casino' }
    ],
    'Nanite': [
        { struct: 'city.nanite_factory' }
    ],
    'Nano_Tube': [
        { struct: 'galaxy.gateway_depot' }
    ],
    'Neutronium': [
        { struct: 'galaxy.gateway_depot' },
        { struct: 'interstellar.cargo_yard' },
        { struct: 'interstellar.neutron_miner', powered: true },
        { struct: 'space.outpost' }
    ],
    'Oil': [
        { struct: '?.nexus', powered: true },
        { struct: '?.orbital_platform', powered: true },
        { struct: '?.refueling_station', powered: true },
        { struct: '?.xfer_station', powered: true },
        { struct: 'city.oil_depot' },
        { struct: 'city.oil_well' },
        { struct: 'portal.pumpjack' },
        { struct: 'space.gas_storage' },
        { struct: 'space.propellant_depot' }
    ],
    'Omniscience': [
        { struct: 'eden.archive' },
        { struct: 'eden.encampment', powered: true },
        { struct: 'eden.research_station' },
        { struct: 'portal.corpse_pile' },
        { struct: 'portal.mortuary' }
    ],
    'Slave': [
        { struct: 'city.slave_pen' }
    ],
    'Stone': [
        { struct: 'city.rock_quarry' }
    ],
    'Uranium': [
        { struct: '?.xfer_station', powered: true },
        { struct: 'city.oil_depot' },
        { struct: 'galaxy.gateway_depot' },
        { struct: 'space.gas_storage' }
    ],
    'Water': [
        { struct: '?.titan_spaceport', powered: true }
    ],
    'Zen': [
        { struct: 'city.meditation' }
    ],
    'global.race.species': [
        { struct: '?.arcology', powered: true },
        { struct: '?.colony', powered: true },
        { struct: '?.s_gate', powered: true },
        { struct: 'city.apartment' },
        { struct: 'city.basic_housing' },
        { struct: 'city.cottage' },
        { struct: 'city.farm' },
        { struct: 'city.lodge' },
        { struct: 'eden.rectory' },
        { struct: 'galaxy.consulate', powered: true },
        { struct: 'galaxy.dormitory', powered: true },
        { struct: 'interstellar.habitat', powered: true },
        { struct: 'interstellar.luxury_condo', powered: true },
        { struct: 'portal.dig_demon' },
        { struct: 'portal.hovel' },
        { struct: 'space.living_quarters' },
        { struct: 'space.titan_quarters' },
        { struct: 'tauceti.tau_housing' },
        { struct: 'tauceti.tauceti_casino' }
    ],
    'res': [
        { struct: 'city.shed' },
        { struct: 'eden.warehouse' },
        { struct: 'interstellar.warehouse' },
        { struct: 'portal.harbor', powered: true },
        { struct: 'portal.warehouse' },
        { struct: 'space.garage' },
        { struct: 'space.storehouse' },
        { struct: 'tauceti.repository' }
    ]
};

// Cap sources that are not buildings or research and so cannot be acted on by
// constructing something: race traits, shrine bonuses, and the crate/container
// accounting itself. Listed for completeness so the drift check below knows
// they were seen and deliberately skipped.
export const capSourcesUnresolved = [
    {
        "line": 8962,
        "res": "global.race.species",
        "guard": "global.race['lone_survivor']){"
    },
    {
        "line": 9255,
        "res": "Knowledge",
        "guard": "shrineBonusActive()){"
    },
    {
        "line": 9363,
        "res": "Knowledge",
        "guard": "global.race['logical']){"
    },
    {
        "line": 9456,
        "res": "Knowledge",
        "guard": "global.race['warlord']){"
    },
    {
        "line": 9459,
        "res": "Crates",
        "guard": "global.race['warlord']){"
    },
    {
        "line": 9461,
        "res": "Containers",
        "guard": "global.race['warlord']){"
    },
    {
        "line": 10328,
        "res": "Crates",
        "guard": "diff > 0){"
    },
    {
        "line": 10342,
        "res": "Containers",
        "guard": "diff > 0){"
    },
    {
        "line": 10356,
        "res": "res",
        "guard": ""
    },
    {
        "line": 10358,
        "res": "res",
        "guard": ""
    }
];
