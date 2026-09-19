import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('profile loader regeneration handles rejection and always restores controls', async () => {
    const source = await readFile(new URL('../../systems/profile-system.js', import.meta.url), 'utf8');
    const loader = source.slice(
        source.indexOf('function buildProfileLoaderPanel()'),
        source.indexOf('function checkProfileStartupStatus()'),
    );

    assert.equal((loader.match(/\.catch\(error\s*=>/g) || []).length, 2);
    assert.equal((loader.match(/\.finally\(\(\)\s*=>\s*btn\.prop\('disabled', false\)\)/g) || []).length, 2);
    assert.equal((loader.match(/toastr\.error/g) || []).length, 2);
});

test('profile management actions use transactional data APIs and report failures', async () => {
    const source = await readFile(new URL('../../systems/profile-system.js', import.meta.url), 'utf8');
    const changes = source.slice(
        source.indexOf("$('.gd-changes-btn-apply')"),
        source.indexOf('function refreshProfileManagementUI()'),
    );
    const cards = source.slice(source.indexOf('function bindProfileCardActions()'));

    assert.match(changes, /await\s+archiveProfiles\(toArchive\)/);
    assert.match(changes, /catch\s*\(error\)[\s\S]*finally\s*\{[\s\S]*btn\.prop\('disabled', false\)/);
    assert.doesNotMatch(changes, /delete\s+profiles\[/);

    assert.match(cards, /await\s+saveProfile\(avatar, next\)/);
    assert.match(cards, /await\s+archiveProfiles\(\[avatar\]\)/);
    assert.ok((cards.match(/toastr\.error/g) || []).length >= 3);
});

test('profile cards never derive raw HTML ids or selectors from imported avatars', async () => {
    const source = await readFile(new URL('../../systems/profile-system.js', import.meta.url), 'utf8');
    const management = source.slice(source.indexOf('function refreshProfileManagementUI()'));

    assert.doesNotMatch(management, /CSS\.escape/);
    assert.doesNotMatch(management, /id="gd-profile-edit-\$\{/);
    assert.match(management, /closest\('\.gd-profile-card'\)\.find\('\.gd-profile-card-edit'\)/);
    assert.match(management, /data-avatar="\$\{esc\(avatar\)\}"/);
});
