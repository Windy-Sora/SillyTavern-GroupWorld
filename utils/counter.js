let roundCounter = 0;

export function roundCounterNext() {
    return roundCounter++;
}

export function roundCounterReset() {
    roundCounter = 0;
}

export function roundCounterGet() {
    return roundCounter;
}

export function roundCounterSet(n) {
    roundCounter = n;
}

let promptCounter = 0;

export function promptCounterNext() {
    return promptCounter++;
}

export function promptCounterReset() {
    promptCounter = 0;
}
