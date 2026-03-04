import { PartSimulationRegistry } from './PartSimulationRegistry';
import type { AVRSimulator } from '../AVRSimulator';

/**
 * RGB LED implementation 
 * Translates digital HIGH/LOW to corresponding 255/0 values on RGB channels
 */
PartSimulationRegistry.register('rgb-led', {
    onPinStateChange: (pinName: string, state: boolean, element: HTMLElement) => {
        const el = element as any;
        if (pinName === 'R') {
            el.ledRed = state ? 255 : 0;
        } else if (pinName === 'G') {
            el.ledGreen = state ? 255 : 0;
        } else if (pinName === 'B') {
            el.ledBlue = state ? 255 : 0;
        }
    }
});

/**
 * Analog Potentiometer implementation
 */
PartSimulationRegistry.register('potentiometer', {
    attachEvents: (element: HTMLElement, avrSimulator: AVRSimulator, getArduinoPinHelper: (pin: string) => number | null) => {
        // A potentiometer's 'SIG' pin goes to an Analog In (A0-A5). 
        // We map generic pin integers back to our ADC logic.
        // E.g., A0 = pin 14 on UNO

        // Potentiometer emits 'input' events when dragged
        const onInput = (_e: Event) => {
            const arduinoPin = getArduinoPinHelper('SIG');
            // If connected to Analog Pin (14-19 is A0-A5 on Uno)
            if (arduinoPin !== null && arduinoPin >= 14 && arduinoPin <= 19) {
                // Find the analog channel (0-5)
                const channel = arduinoPin - 14;

                // Element's value is between 0-1023
                const value = parseInt((element as any).value || '0', 10);

                // Access avr8js ADC to inject analog voltages
                // (Assuming getADC is implemented in AVRSimulator)
                const adc: any = (avrSimulator as any).getADC?.();
                if (adc) {
                    // ADC wants a float voltage from 0 to 5V. 
                    // Potentiometer is linearly 0-1023 -> 5V max
                    const volts = (value / 1023.0) * 5.0;
                    adc.channelValues[channel] = volts;
                }
            }
        };

        element.addEventListener('input', onInput);

        return () => {
            element.removeEventListener('input', onInput);
        };
    },
});

/**
 * HD44780 LCD Controller Simulation (for LCD 1602 and LCD 2004)
 * 
 * Implements the 4-bit mode protocol used by the Arduino LiquidCrystal library.
 * The HD44780 controller uses 6 signal lines in 4-bit mode:
 *   RS (Register Select): 0 = command, 1 = data
 *   E  (Enable): Data is latched on falling edge (HIGH→LOW)
 *   D4-D7: 4 data bits (high nibble first, then low nibble)
 * 
 * DDRAM address mapping for multi-line displays:
 *   Line 0: 0x00-0x13 (or 0x00-0x0F for 16x2)
 *   Line 1: 0x40-0x53 (or 0x40-0x4F for 16x2)
 *   Line 2: 0x14-0x27 (20x4 only)
 *   Line 3: 0x54-0x67 (20x4 only)
 */
function createLcdSimulation(cols: number, rows: number) {
    return {
        attachEvents: (element: HTMLElement, avrSimulator: AVRSimulator, getArduinoPinHelper: (pin: string) => number | null) => {
            const el = element as any;

            // HD44780 internal state
            const ddram = new Uint8Array(128).fill(0x20); // Display Data RAM (space = 0x20)
            let ddramAddress = 0;           // Current DDRAM address
            let entryIncrement = true;      // true = increment, false = decrement
            let displayOn = true;           // Is display on?
            let cursorOn = false;           // Underline cursor visible?
            let blinkOn = false;            // Blinking block cursor?
            let nibbleState: 'high' | 'low' = 'high'; // 4-bit mode nibble tracking
            let highNibble = 0;             // Stored high nibble
            let initialized = false;        // Has initialization sequence completed?
            let initCount = 0;              // Count initialization nibbles

            // Pin states tracked locally
            let rsState = false;
            let eState = false;
            let d4State = false;
            let d5State = false;
            let d6State = false;
            let d7State = false;

            // DDRAM line offsets for the HD44780
            const lineOffsets = rows >= 4
                ? [0x00, 0x40, 0x14, 0x54]  // 20x4 LCD
                : [0x00, 0x40];              // 16x2 LCD

            // Convert DDRAM address to linear buffer index for the element
            function ddramToLinear(addr: number): number {
                for (let row = 0; row < rows; row++) {
                    const offset = lineOffsets[row];
                    if (addr >= offset && addr < offset + cols) {
                        return row * cols + (addr - offset);
                    }
                }
                return -1; // Address not visible
            }

            // Refresh the wokwi-element's characters from our DDRAM
            function refreshDisplay() {
                if (!displayOn) {
                    // Blank display
                    el.characters = new Uint8Array(cols * rows).fill(0x20);
                    return;
                }

                const chars = new Uint8Array(cols * rows);
                for (let row = 0; row < rows; row++) {
                    const offset = lineOffsets[row];
                    for (let col = 0; col < cols; col++) {
                        chars[row * cols + col] = ddram[offset + col];
                    }
                }
                el.characters = chars;
                el.cursor = cursorOn;
                el.blink = blinkOn;

                // Set cursor position
                const cursorLinear = ddramToLinear(ddramAddress);
                if (cursorLinear >= 0) {
                    el.cursorX = cursorLinear % cols;
                    el.cursorY = Math.floor(cursorLinear / cols);
                }
            }

            // Process a complete byte (command or data)
            function processByte(rs: boolean, data: number) {
                if (!rs) {
                    // === COMMAND ===
                    if (data & 0x80) {
                        // Set DDRAM Address (bit 7 = 1)
                        ddramAddress = data & 0x7F;
                    } else if (data & 0x40) {
                        // Set CGRAM Address - not implemented for display
                    } else if (data & 0x20) {
                        // Function Set (usually during init)
                        // DL=0 means 4-bit mode (already assumed)
                        initialized = true;
                    } else if (data & 0x10) {
                        // Cursor/Display Shift
                        const sc = (data >> 3) & 1;
                        const rl = (data >> 2) & 1;
                        if (!sc) {
                            // Move cursor
                            ddramAddress += rl ? 1 : -1;
                            ddramAddress &= 0x7F;
                        }
                    } else if (data & 0x08) {
                        // Display On/Off Control
                        displayOn = !!(data & 0x04);
                        cursorOn = !!(data & 0x02);
                        blinkOn = !!(data & 0x01);
                    } else if (data & 0x04) {
                        // Entry Mode Set
                        entryIncrement = !!(data & 0x02);
                    } else if (data & 0x02) {
                        // Return Home
                        ddramAddress = 0;
                    } else if (data & 0x01) {
                        // Clear Display
                        ddram.fill(0x20);
                        ddramAddress = 0;
                    }
                } else {
                    // === DATA (character write) ===
                    ddram[ddramAddress & 0x7F] = data;

                    // Auto-increment/decrement address
                    if (entryIncrement) {
                        ddramAddress = (ddramAddress + 1) & 0x7F;
                    } else {
                        ddramAddress = (ddramAddress - 1) & 0x7F;
                    }
                }

                refreshDisplay();
            }

            // Handle Enable pin falling edge - this is where data is latched
            function onEnableFallingEdge() {
                // Read D4-D7 to form a nibble
                const nibble =
                    (d4State ? 0x01 : 0) |
                    (d5State ? 0x02 : 0) |
                    (d6State ? 0x04 : 0) |
                    (d7State ? 0x08 : 0);

                // During initialization, the LiquidCrystal library sends
                // several single-nibble commands (0x03, 0x03, 0x03, 0x02)
                // before switching to 4-bit mode proper
                if (!initialized) {
                    initCount++;
                    if (initCount >= 4) {
                        initialized = true;
                        nibbleState = 'high';
                    }
                    return;
                }

                if (nibbleState === 'high') {
                    // First nibble (high 4 bits)
                    highNibble = nibble << 4;
                    nibbleState = 'low';
                } else {
                    // Second nibble (low 4 bits) → combine and process
                    const fullByte = highNibble | nibble;
                    nibbleState = 'high';
                    processByte(rsState, fullByte);
                }
            }

            // Get Arduino pin numbers for LCD pins
            const pinRS = getArduinoPinHelper('RS');
            const pinE = getArduinoPinHelper('E');
            const pinD4 = getArduinoPinHelper('D4');
            const pinD5 = getArduinoPinHelper('D5');
            const pinD6 = getArduinoPinHelper('D6');
            const pinD7 = getArduinoPinHelper('D7');

            console.log(`[LCD] Pin mapping: RS=${pinRS}, E=${pinE}, D4=${pinD4}, D5=${pinD5}, D6=${pinD6}, D7=${pinD7}`);

            // Subscribe to pin changes via PinManager
            const pinManager = (avrSimulator as any).pinManager;
            if (!pinManager) {
                console.warn('[LCD] No pinManager found on AVRSimulator');
                return () => { };
            }

            const unsubscribers: (() => void)[] = [];

            if (pinRS !== null) {
                unsubscribers.push(pinManager.onPinChange(pinRS, (_p: number, state: boolean) => {
                    rsState = state;
                }));
            }

            if (pinD4 !== null) {
                unsubscribers.push(pinManager.onPinChange(pinD4, (_p: number, state: boolean) => {
                    d4State = state;
                }));
            }

            if (pinD5 !== null) {
                unsubscribers.push(pinManager.onPinChange(pinD5, (_p: number, state: boolean) => {
                    d5State = state;
                }));
            }

            if (pinD6 !== null) {
                unsubscribers.push(pinManager.onPinChange(pinD6, (_p: number, state: boolean) => {
                    d6State = state;
                }));
            }

            if (pinD7 !== null) {
                unsubscribers.push(pinManager.onPinChange(pinD7, (_p: number, state: boolean) => {
                    d7State = state;
                }));
            }

            // Enable pin: watch for falling edge (HIGH → LOW)
            if (pinE !== null) {
                unsubscribers.push(pinManager.onPinChange(pinE, (_p: number, state: boolean) => {
                    const wasHigh = eState;
                    eState = state;

                    // Falling edge: data is latched
                    if (wasHigh && !state) {
                        onEnableFallingEdge();
                    }
                }));
            }

            // Initialize display as blank
            refreshDisplay();
            console.log(`[LCD] ${cols}x${rows} simulation initialized`);

            return () => {
                unsubscribers.forEach(u => u());
                console.log(`[LCD] ${cols}x${rows} simulation cleaned up`);
            };
        },
    };
}

// Register LCD 1602 (16x2)
PartSimulationRegistry.register('lcd1602', createLcdSimulation(16, 2));

// Register LCD 2004 (20x4)
PartSimulationRegistry.register('lcd2004', createLcdSimulation(20, 4));

