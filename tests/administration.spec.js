'use strict';

const { test, expect } = require('@playwright/test');
const { adminLogin } = require('./helpers');

test.describe('public administration directory', () => {
  test('only shows approved departments/officials, and council member committee chips only for approved committees', async ({
    page,
    browser,
  }) => {
    await adminLogin(page);

    // -- department: one pending, one approved -----------------------------
    const pendingDept = await page.request.post('/api/departments', {
      data: { name: 'E2E Чакащ отдел', description: 'не трябва да се вижда' },
    });
    expect(pendingDept.ok()).toBeTruthy();

    const approvedDept = await page.request.post('/api/departments', {
      data: { name: 'E2E Одобрен отдел', description: 'публично видим' },
    });
    expect(approvedDept.ok()).toBeTruthy();
    const approvedDeptBody = await approvedDept.json();
    const approveDeptRes = await page.request.post(
      `/api/review/departments/${approvedDeptBody.department.id}/approve`
    );
    expect(approveDeptRes.ok()).toBeTruthy();

    // -- council member + two committees (one approved, one pending) -------
    const memberRes = await page.request.post('/api/council-members', {
      data: { name: 'E2E Съветник Иванов', party: 'E2E Партия' },
    });
    const memberBody = await memberRes.json();
    await page.request.post(`/api/review/council_members/${memberBody.council_member.id}/approve`);

    const approvedCommitteeRes = await page.request.post('/api/committees', {
      data: { name: 'E2E Одобрена комисия' },
    });
    const approvedCommitteeBody = await approvedCommitteeRes.json();
    await page.request.post(
      `/api/review/committees/${approvedCommitteeBody.committee.id}/approve`
    );

    const pendingCommitteeRes = await page.request.post('/api/committees', {
      data: { name: 'E2E Чакаща комисия' },
    });
    const pendingCommitteeBody = await pendingCommitteeRes.json();
    // left pending on purpose

    await page.request.post('/api/committee-memberships', {
      data: {
        council_member_id: memberBody.council_member.id,
        committee_id: approvedCommitteeBody.committee.id,
        role: 'Председател',
      },
    });
    await page.request.post('/api/committee-memberships', {
      data: {
        council_member_id: memberBody.council_member.id,
        committee_id: pendingCommitteeBody.committee.id,
      },
    });

    // -- check the PUBLIC contract from a genuinely unauthenticated context -
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();

    await anonPage.goto('/administration/');
    await expect(anonPage.getByText('E2E Одобрен отдел')).toBeVisible();
    await expect(anonPage.getByText('E2E Чакащ отдел')).not.toBeVisible();

    // "E2E Съветник Иванов" legitimately appears twice on the page (once as
    // his own council-member card, once inside the committee card's member
    // list) -- .first() just disambiguates the locator, both are expected.
    await expect(anonPage.getByText('E2E Съветник Иванов').first()).toBeVisible();
    await expect(anonPage.getByText('E2E Одобрена комисия').first()).toBeVisible();
    await expect(anonPage.getByText('E2E Чакаща комисия')).not.toBeVisible();

    await anonContext.close();
  });
});

test.describe('admin administration workflow', () => {
  test('admin can create+approve a department, official, council member and committee, assign a membership, and it all appears on the public page', async ({
    page,
    browser,
  }) => {
    await adminLogin(page);
    await page.goto('/admin/administration.html');

    // -- Department ----------------------------------------------------------
    await page.click('#new-department-btn');
    await page.fill('#department-name', 'E2E Админ отдел');
    await page.fill('#department-description', 'Създаден през админ формата');
    await page.click('#department-form-panel button[type="submit"]');
    // "E2E Админ отдел" legitimately appears twice in the admin DOM at this
    // point (the departments table row, and as an <option> in the hidden
    // Officials form's department <select>) -- scope to the table row.
    let deptRow = page.locator('tr', { hasText: 'E2E Админ отдел' });
    await expect(deptRow).toBeVisible();
    await deptRow.getByRole('button', { name: 'Одобри' }).click();

    // The departments table defaults to the "pending" status tab, so an
    // approved row drops out of view immediately -- switch to "Всички" to
    // see it again with its updated badge.
    await page.click('#panel-departments .status-tabs button[data-status="all"]');
    deptRow = page.locator('tr', { hasText: 'E2E Админ отдел' });
    await expect(deptRow.getByText('Одобрено')).toBeVisible();

    // -- Official (assigned to that department) -------------------------------
    await page.click('button[data-entity="officials"]');
    await page.click('#new-official-btn');
    await page.fill('#official-name', 'E2E Служител Петров');
    await page.fill('#official-position', 'Специалист');
    await page.selectOption('#official-department', { label: 'E2E Админ отдел' });
    await page.fill('#official-email', 'e2e@example.com');
    await page.click('#official-form-panel button[type="submit"]');
    await expect(page.getByText('E2E Служител Петров')).toBeVisible();

    let officialRow = page.locator('tr', { hasText: 'E2E Служител Петров' });
    await officialRow.getByRole('button', { name: 'Одобри' }).click();

    // -- Committee -------------------------------------------------------------
    await page.click('button[data-entity="committees"]');
    await page.click('#new-committee-btn');
    await page.fill('#committee-name', 'E2E Админ комисия');
    await page.click('#committee-form-panel button[type="submit"]');
    // Scoped to the table row -- "E2E Админ комисия" also exists as a
    // hidden <option> in the (not-yet-opened) membership panel's committee
    // <select> by this point.
    let committeeRow = page.locator('tr', { hasText: 'E2E Админ комисия' });
    await expect(committeeRow).toBeVisible();
    await committeeRow.getByRole('button', { name: 'Одобри' }).click();

    // -- Council member + membership assignment ---------------------------------
    await page.click('button[data-entity="council-members"]');
    await page.click('#new-council-member-btn');
    await page.fill('#council-member-name', 'E2E Съветник Георгиев');
    await page.fill('#council-member-party', 'E2E Партия 2');
    await page.click('#council-member-form-panel button[type="submit"]');
    await expect(page.getByText('E2E Съветник Георгиев')).toBeVisible();

    let memberRow = page.locator('tr', { hasText: 'E2E Съветник Георгиев' });
    await memberRow.getByRole('button', { name: 'Одобри' }).click();

    // The council-members table also defaults to the "pending" status tab,
    // so the row drops out of view immediately after approval -- switch to
    // "Всички" before locating it again for the membership action.
    await page.click('#panel-council-members .status-tabs button[data-status="all"]');
    memberRow = page.locator('tr', { hasText: 'E2E Съветник Георгиев' });
    await memberRow.getByRole('button', { name: 'Комисии' }).click();

    await expect(page.locator('#membership-panel')).toBeVisible();
    await page.selectOption('#membership-committee-select', { label: 'E2E Админ комисия' });
    await page.fill('#membership-role-input', 'Председател');
    await page.click('#membership-add-btn');

    await expect(page.locator('#membership-current-list')).toContainText('E2E Админ комисия');
    await page.click('#membership-panel-close');

    // -- Verify it reaches the real public page too, from a fresh unauthenticated context.
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto('/administration/');

    await expect(anonPage.getByText('E2E Админ отдел')).toBeVisible();
    await expect(anonPage.getByText('E2E Служител Петров')).toBeVisible();
    await expect(anonPage.getByText('e2e@example.com')).toBeVisible();

    // "E2E Съветник Георгиев" legitimately appears twice on the public page
    // (his own council-member card, and inside the committee's member list
    // now that he's assigned to it) -- .first() disambiguates the locator.
    await expect(anonPage.getByText('E2E Съветник Георгиев').first()).toBeVisible();
    await expect(anonPage.getByText('E2E Админ комисия').first()).toBeVisible();

    await anonContext.close();
  });
});

test.describe('administration API auth pen test', () => {
  test('mutating administration routes return 401 with no session cookie', async ({ page }) => {
    // Fresh page/context -- no admin cookie has been set anywhere in this test.
    const deptRes = await page.request.post('/api/departments', {
      data: { name: 'Опит без сесия' },
    });
    expect(deptRes.status()).toBe(401);

    const memberRes = await page.request.post('/api/council-members', {
      data: { name: 'Опит без сесия' },
    });
    expect(memberRes.status()).toBe(401);

    const membershipRes = await page.request.post('/api/committee-memberships', {
      data: { council_member_id: 1, committee_id: 1 },
    });
    expect(membershipRes.status()).toBe(401);
  });
});
