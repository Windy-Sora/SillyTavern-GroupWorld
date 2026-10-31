// Fixed interpretation boundaries, never inferred from user content or runtime symptoms.
const scopes = {
    'card-directory': 'Names and selectors only; no card body, Persona selection or runtime diagnosis.',
    'saved-card-text': 'Saved literal card text only. A loading label in HTML is not a loading-status observation: it neither explains why the label remains nor rules out loading failure. This page does not cover global scripts/regex, live variables, actual rendering or final injection.',
    'director-structure': 'Current director state and retained history structure only, not user Persona identity. Zero retained records means zero now; it does not prove no earlier generation/save or establish deletion, switching or a failure cause.',
};
export const observationBoundarySchema = { type: 'object', properties: {
    scope: { type: 'string', enum: Object.keys(scopes) },
    meaning: { type: 'string', maxLength: 500 },
}, required: ['scope', 'meaning'], additionalProperties: false };
export function observationBoundary(scope) {
    if (!Object.hasOwn(scopes, scope)) throw new TypeError('Unknown observation scope');
    return { scope, meaning: scopes[scope] };
}
