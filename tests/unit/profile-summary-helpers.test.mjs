import assert from 'node:assert/strict';
import test from 'node:test';
import {
    formatProfileSummary,
    getProfileSummaryEditValue,
} from '../../ui/sections/profile-summary-helpers.js';

const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

test('profile summary editing reads only the raw summary field', () => {
    const profile = {
        summary: 'Quiet observer',
        tags: ['patient', 'careful'],
        motivation: 'Protect the group',
    };

    assert.equal(getProfileSummaryEditValue(profile), 'Quiet observer');
    assert.equal(
        formatProfileSummary(profile, 'en', escapeHtml),
        'Quiet observer<br>Tags: patient, careful<br>Motivation: Protect the group',
    );
});

test('profile summary display escapes data without contaminating the edit value', () => {
    const profile = {
        summary: '<b>raw</b>',
        tags: ['<img src=x>'],
        motivation: '<script>alert(1)</script>',
    };

    const display = formatProfileSummary(profile, 'zh', escapeHtml);
    assert.equal(getProfileSummaryEditValue(profile), '<b>raw</b>');
    assert.equal(display.includes('<img'), false);
    assert.equal(display.includes('<script>'), false);
    assert.equal(display.includes('标签：'), true);
    assert.equal(display.includes('动机：'), true);
});
