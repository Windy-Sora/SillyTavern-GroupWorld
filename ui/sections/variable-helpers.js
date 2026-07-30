export function hasVariableIdCollision(variableSystem, oldId, newId) {
    return newId !== oldId && !!variableSystem.getDefinition(newId);
}
