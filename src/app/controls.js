import { catalogControlServices } from './catalog.js';
import { StyleManager } from '../ui/composition.js';
import { initCockpitCloudEffects } from '../cockpitCloudEffects.js';
import * as Cesium from 'cesium';

/** Construct the existing controls and camera presentation. */
export function createApplicationControls({
  scene: { viewer, mapStackController, operations },
  loaderStatus,
  Controls = StyleManager,
  services,
  catalog,
  placeSearch,
  defer,
}) {
  // Initialize the style manager (post-processing, HUD, locations, share links)
  const styleManager = new Controls(viewer, {
    services: {
      ...services,
      ...operations.surface.controlServices,
      searchAndFlyTo: operations.searchAndFlyTo,
      fetchRegionalBrief: (...args) =>
        operations.requests.regional.getBrief(...args),
      ...catalogControlServices(catalog),
    },
    requestServices: operations.requests,
    mapStackController,
    placeSearch,
  });
  // SunWatch uses source-backed readouts without an AI subscription.
  if (styleManager.hud?.summaryPolicy)
    styleManager.hud.summaryPolicy.canRequest = () => false;
  defer(() => styleManager.orbitController.stop());
  defer(() => styleManager.hud.destroy());
  defer(() => styleManager.dispose());
  // The previous multi-canvas weather compositor remains disabled. Cockpit
  // clouds use a separate, capped low-resolution GPU pass that never attaches
  // Cesium fog or post-process stages and is fully stopped in map mode.
  const weatherEffects = null;
  const cockpitCloudEffects = initCockpitCloudEffects(viewer, {
    weatherService: operations.requests.weather,
  });
  defer(() => cockpitCloudEffects?.destroy());

  // Start at the Florida network unless restoring a shared camera.
  if (!styleManager.hasShareState) {
    loaderStatus.textContent = 'Opening Suncoast network, Florida...';
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-82.2, 28.0, 420000),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
  } else {
    loaderStatus.textContent = 'Restoring shared view...';
  }

  return { styleManager, weatherEffects, cockpitCloudEffects };
}
