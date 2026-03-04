import { PartSimulationRegistry } from './PartSimulationRegistry';
import type { AVRSimulator } from '../AVRSimulator';

/**
 * Basic Pushbutton implementation
 */
PartSimulationRegistry.register('pushbutton', {
    attachEvents: (element, avrSimulator, getArduinoPinHelper) => {
        // 1. Find which Arduino pin is connected to terminal '1.L' or '2.L'
        const arduinoPin =
            getArduinoPinHelper('1.l') ?? getArduinoPinHelper('2.l') ??
            getArduinoPinHelper('1.r') ?? getArduinoPinHelper('2.r');

        if (arduinoPin === null) {
            return () => { }; // no-op if unconnected
        }

        const onButtonPress = () => {
            // By default wokwi pushbuttons are active LOW (connected to GND)
            avrSimulator.setPinState(arduinoPin, false);
            (element as any).pressed = true;
        };

        const onButtonRelease = () => {
            // Release lets the internal pull-up pull it HIGH
            avrSimulator.setPinState(arduinoPin, true);
            (element as any).pressed = false;
        };

        element.addEventListener('button-press', onButtonPress);
        element.addEventListener('button-release', onButtonRelease);

        return () => {
            element.removeEventListener('button-press', onButtonPress);
            element.removeEventListener('button-release', onButtonRelease);
        };
    },
});

/**
 * Basic LED implementation
 */
PartSimulationRegistry.register('led', {
    onPinStateChange: (pinName, state, element) => {
        if (pinName === 'A') { // Anode
            (element as any).value = state;
        }
        // We ignore cathode 'C' in this simple digital model
    }
});
