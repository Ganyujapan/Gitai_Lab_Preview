/* Gitai Lab shared habitat catalog, locale names and temporary test access.
 * IMPORTANT: disable TEST_MODE for a production trophy-locked release.
 * IDs are durable storage namespaces; kusagi_001 is kept for existing saves.
 */
(function(root){
  'use strict';
  const TEST_MODE=true;
  const DEFAULT_ENVIRONMENT='kusagi_001';
  const USER_HABITATS=Object.freeze([{"id":"kusagi_001","file":"bg_leaf01.png","ja":"葉1","en":"Leaf 1","asset":"img/backgrounds/bg_leaf01.png"},{"id":"leaf_002","file":"bg_leaf02.png","ja":"葉2","en":"Leaf 2","asset":"img/backgrounds/bg_leaf02.png"},{"id":"leaf_003","file":"bg_leaf03.png","ja":"葉3","en":"Leaf 3","asset":"img/backgrounds/bg_leaf03.png"},{"id":"bush_001","file":"bg_bush01.png","ja":"茂み1","en":"Bush 1","asset":"img/backgrounds/bg_bush01.png"},{"id":"bush_002","file":"bg_bush02.png","ja":"茂み2","en":"Bush 2","asset":"img/backgrounds/bg_bush02.png"},{"id":"grass_001","file":"bg_grass01.png","ja":"草むら","en":"Grass","asset":"img/backgrounds/bg_grass01.png"},{"id":"bark_photo_001","file":"bg_bark01.png","ja":"樹皮","en":"Bark","asset":"img/backgrounds/bg_bark01.png"},{"id":"dryleaf_001","file":"bg_dryleaf01.png","ja":"落ち葉","en":"Fallen Leaves","asset":"img/backgrounds/bg_dryleaf01.png"},{"id":"sand_photo_001","file":"bg_sand01.png","ja":"砂地","en":"Sand","asset":"img/backgrounds/bg_sand01.png"},{"id":"stone_001","file":"bg_stone01.png","ja":"岩肌","en":"Rock","asset":"img/backgrounds/bg_stone01.png"},{"id":"shell_001","file":"bg_shell01.png","ja":"貝殻","en":"Shell","asset":"img/backgrounds/bg_shell01.png"},{"id":"wood_001","file":"bg_wood01.png","ja":"木の板1","en":"Wood Board 1","asset":"img/backgrounds/bg_wood01.png"},{"id":"wood_002","file":"bg_wood02.png","ja":"木の板2","en":"Wood Board 2","asset":"img/backgrounds/bg_wood02.png"}]);
  const LEGACY_COMPARISONS=Object.freeze([{"id":"bark_001","file":"bg_preview.svg","ja":"旧樹皮（比較用）","en":"Old Bark (Comparison)","asset":"img/backgrounds/bg_preview.svg","comparison":true},{"id":"sand_001","file":"bg_desert_preview.svg","ja":"旧砂地（比較用）","en":"Old Sand (Comparison)","asset":"img/backgrounds/bg_desert_preview.svg","comparison":true}]);
  const TEST_HABITATS=Object.freeze([...USER_HABITATS,...LEGACY_COMPARISONS]);
  const lookup=id=>TEST_HABITATS.find(item=>item.id===id);
  const locale=(root.location && new URLSearchParams(root.location.search).get('lang')==='en')?'en':'ja';
  const api=Object.freeze({
    testMode:TEST_MODE,defaultEnvironment:DEFAULT_ENVIRONMENT,
    locale,
    userHabitats:USER_HABITATS,
    legacyComparisons:LEGACY_COMPARISONS,
    allHabitats:TEST_HABITATS,
    testingEnvironments:Object.freeze(TEST_HABITATS.map(e=>e.id)),
    releasedEnvironments:Object.freeze([DEFAULT_ENVIRONMENT]),
    get:lookup,
    label:(id,lang=locale)=>lookup(id)?.[lang==='en'?'en':'ja']||id,
  });
  root.GitaiHabitatAccess=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
