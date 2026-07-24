/*
 * Community Лом -- Admin "Общинска администрация" (Administration &
 * Contacts) page. Plain script, no bundler -- relies on
 * /admin/admin-common.js being loaded first for
 * fetchJson/checkAuthOrRedirect/renderAdminNav.
 */

(function (window) {
  'use strict';

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const STATUS_LABELS = {
    pending: 'Чакащо',
    approved: 'Одобрено',
    rejected: 'Отхвърлено',
  };

  function statusBadge(status) {
    return `<span class="badge badge-${status}">${STATUS_LABELS[status] || status}</span>`;
  }

  // ---------------------------------------------------------------------
  // Shared state
  // ---------------------------------------------------------------------

  let currentEntity = 'departments';
  const statusByEntity = {
    departments: 'pending',
    officials: 'pending',
    'council-members': 'pending',
    committees: 'pending',
  };

  let departmentsCache = [];
  let officialsCache = [];
  let councilMembersCache = [];
  let committeesCache = [];

  // Separate from the two caches above, which only ever hold whatever the
  // currently-active status tab filtered for on their own browsing table --
  // that made the "Отдел"/"Комисия" <select> dropdowns (and the officials
  // table's department-name lookup) silently lose options whenever the
  // admin happened to be viewing e.g. the "Чакащи" tab elsewhere. These two
  // are always fetched with ?status=all specifically to back cross-entity
  // selects/lookups, independent of any browsing filter.
  let departmentOptionsCache = [];
  let committeeOptionsCache = [];

  let membershipPanelMemberId = null;

  // ---------------------------------------------------------------------
  // Generic helpers
  // ---------------------------------------------------------------------

  async function reviewAction(table, id, action) {
    return fetchJson(`/api/review/${table}/${id}/${action}`, { method: 'POST' });
  }

  function extractErrorMessage(err) {
    let message = err.message;
    try {
      const parsed = JSON.parse(message.slice(message.indexOf('{')));
      if (parsed.message) message = parsed.message;
      else if (parsed.error) message = parsed.error;
    } catch (parseErr) {
      // keep the raw message
    }
    return message;
  }

  // ---------------------------------------------------------------------
  // Entity tab switching
  // ---------------------------------------------------------------------

  function switchEntityTab(entity) {
    currentEntity = entity;
    document.querySelectorAll('#entity-tabs button').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-entity') === entity);
    });
    document.querySelectorAll('.entity-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `panel-${entity}`);
    });
    loadCurrentEntity();
  }

  function loadCurrentEntity() {
    if (currentEntity === 'departments') return loadDepartments();
    if (currentEntity === 'officials') return loadOfficials();
    if (currentEntity === 'council-members') return loadCouncilMembers();
    if (currentEntity === 'committees') return loadCommittees();
  }

  // ---------------------------------------------------------------------
  // Departments
  // ---------------------------------------------------------------------

  async function refreshDepartmentOptions() {
    try {
      const data = await fetchJson('/api/admin/departments?status=all');
      departmentOptionsCache = (data && data.departments) || [];
      populateDepartmentSelect();
    } catch (err) {
      // Leave whatever options were already populated -- a stale option
      // list is a lesser problem than throwing away the in-progress form.
    }
  }

  async function loadDepartments() {
    const tbody = document.getElementById('departments-tbody');
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Зареждане...</td></tr>';
    try {
      const status = statusByEntity.departments;
      const data = await fetchJson(`/api/admin/departments?status=${encodeURIComponent(status)}`);
      departmentsCache = (data && data.departments) || [];
      renderDepartments();
      await refreshDepartmentOptions();
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Грешка при зареждане.</td></tr>';
    }
  }

  function renderDepartments() {
    const tbody = document.getElementById('departments-tbody');
    if (departmentsCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Няма записи в тази категория.</td></tr>';
      return;
    }
    tbody.innerHTML = departmentsCache
      .map((row) => {
        const isPending = row.review_status === 'pending';
        return `
          <tr data-id="${row.id}">
            <td>${statusBadge(row.review_status)}</td>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.description) || '&mdash;'}</td>
            <td>
              <div class="row-actions">
                ${isPending ? `<button type="button" class="btn-approve" data-action="approve">Одобри</button><button type="button" class="btn-reject" data-action="reject">Отхвърли</button>` : ''}
                <button type="button" class="btn-secondary" data-action="edit">Редакция</button>
                <button type="button" class="btn-danger" data-action="delete">Изтрий</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function openDepartmentForm(row) {
    const panel = document.getElementById('department-form-panel');
    const title = document.getElementById('department-form-title');
    const errorBox = document.getElementById('department-form-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    document.getElementById('department-id').value = row ? row.id : '';
    document.getElementById('department-name').value = row ? row.name || '' : '';
    document.getElementById('department-description').value = row ? row.description || '' : '';

    title.textContent = row ? 'Редактиране на отдел' : 'Нов отдел';
    panel.classList.add('open');
    document.getElementById('department-name').focus();
  }

  function closeDepartmentForm() {
    document.getElementById('department-form-panel').classList.remove('open');
    document.getElementById('department-form').reset();
  }

  async function handleDepartmentFormSubmit(event) {
    event.preventDefault();
    const errorBox = document.getElementById('department-form-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    const id = document.getElementById('department-id').value;
    const body = {
      name: document.getElementById('department-name').value.trim(),
      description: document.getElementById('department-description').value.trim() || null,
    };

    try {
      if (id) {
        await fetchJson(`/api/departments/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetchJson('/api/departments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      closeDepartmentForm();
      await loadDepartments();
    } catch (err) {
      errorBox.textContent = extractErrorMessage(err);
      errorBox.classList.add('visible');
    }
  }

  async function handleDepartmentsTableClick(event) {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const row = btn.closest('tr');
    const id = row.getAttribute('data-id');
    const action = btn.getAttribute('data-action');

    if (action === 'approve' || action === 'reject') {
      btn.disabled = true;
      try {
        await reviewAction('departments', id, action);
        await loadDepartments();
      } catch (err) {
        alert('Действието не бе успешно: ' + err.message);
        btn.disabled = false;
      }
      return;
    }
    if (action === 'edit') {
      const item = departmentsCache.find((r) => String(r.id) === String(id));
      if (item) openDepartmentForm(item);
      return;
    }
    if (action === 'delete') {
      if (!confirm('Сигурни ли сте, че искате да изтриете този отдел?')) return;
      try {
        await fetchJson(`/api/departments/${id}`, { method: 'DELETE' });
        await loadDepartments();
      } catch (err) {
        alert('Изтриването не бе успешно: ' + err.message);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Officials
  // ---------------------------------------------------------------------

  function populateDepartmentSelect() {
    const select = document.getElementById('official-department');
    const current = select.value;
    select.innerHTML =
      '<option value="">— без отдел —</option>' +
      departmentOptionsCache
        .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
        .join('');
    select.value = current;
  }

  async function loadOfficials() {
    const tbody = document.getElementById('officials-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Зареждане...</td></tr>';
    try {
      // Always refreshed (not just when empty) so a department created or
      // approved elsewhere shows up here without requiring a full page
      // reload -- see departmentOptionsCache's own comment for why this is
      // kept separate from the Departments tab's own status-filtered cache.
      await refreshDepartmentOptions();

      const status = statusByEntity.officials;
      const data = await fetchJson(`/api/admin/officials?status=${encodeURIComponent(status)}`);
      officialsCache = (data && data.officials) || [];
      renderOfficials();
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Грешка при зареждане.</td></tr>';
    }
  }

  function departmentName(departmentId) {
    const dept = departmentOptionsCache.find((d) => d.id === departmentId);
    return dept ? dept.name : '';
  }

  function renderOfficials() {
    const tbody = document.getElementById('officials-tbody');
    if (officialsCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Няма записи в тази категория.</td></tr>';
      return;
    }
    tbody.innerHTML = officialsCache
      .map((row) => {
        const isPending = row.review_status === 'pending';
        const contacts = [row.phone, row.email].filter(Boolean).map(escapeHtml).join('<br>');
        return `
          <tr data-id="${row.id}">
            <td>${statusBadge(row.review_status)}</td>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.position) || '&mdash;'}</td>
            <td>${escapeHtml(departmentName(row.department_id)) || '&mdash;'}</td>
            <td>${contacts || '&mdash;'}</td>
            <td>
              <div class="row-actions">
                ${isPending ? `<button type="button" class="btn-approve" data-action="approve">Одобри</button><button type="button" class="btn-reject" data-action="reject">Отхвърли</button>` : ''}
                <button type="button" class="btn-secondary" data-action="edit">Редакция</button>
                <button type="button" class="btn-danger" data-action="delete">Изтрий</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function openOfficialForm(row) {
    const panel = document.getElementById('official-form-panel');
    const title = document.getElementById('official-form-title');
    const errorBox = document.getElementById('official-form-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    document.getElementById('official-id').value = row ? row.id : '';
    document.getElementById('official-name').value = row ? row.name || '' : '';
    document.getElementById('official-position').value = row ? row.position || '' : '';
    document.getElementById('official-department').value = row && row.department_id ? row.department_id : '';
    document.getElementById('official-email').value = row ? row.email || '' : '';
    document.getElementById('official-phone').value = row ? row.phone || '' : '';

    title.textContent = row ? 'Редактиране на служител' : 'Нов служител';
    panel.classList.add('open');
    document.getElementById('official-name').focus();
  }

  function closeOfficialForm() {
    document.getElementById('official-form-panel').classList.remove('open');
    document.getElementById('official-form').reset();
  }

  async function handleOfficialFormSubmit(event) {
    event.preventDefault();
    const errorBox = document.getElementById('official-form-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    const id = document.getElementById('official-id').value;
    const deptVal = document.getElementById('official-department').value;
    const body = {
      name: document.getElementById('official-name').value.trim(),
      position: document.getElementById('official-position').value.trim() || null,
      department_id: deptVal ? Number(deptVal) : null,
      email: document.getElementById('official-email').value.trim() || null,
      phone: document.getElementById('official-phone').value.trim() || null,
    };

    try {
      if (id) {
        await fetchJson(`/api/officials/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetchJson('/api/officials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      closeOfficialForm();
      await loadOfficials();
    } catch (err) {
      errorBox.textContent = extractErrorMessage(err);
      errorBox.classList.add('visible');
    }
  }

  async function handleOfficialsTableClick(event) {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const row = btn.closest('tr');
    const id = row.getAttribute('data-id');
    const action = btn.getAttribute('data-action');

    if (action === 'approve' || action === 'reject') {
      btn.disabled = true;
      try {
        await reviewAction('officials', id, action);
        await loadOfficials();
      } catch (err) {
        alert('Действието не бе успешно: ' + err.message);
        btn.disabled = false;
      }
      return;
    }
    if (action === 'edit') {
      const item = officialsCache.find((r) => String(r.id) === String(id));
      if (item) openOfficialForm(item);
      return;
    }
    if (action === 'delete') {
      if (!confirm('Сигурни ли сте, че искате да изтриете този служител?')) return;
      try {
        await fetchJson(`/api/officials/${id}`, { method: 'DELETE' });
        await loadOfficials();
      } catch (err) {
        alert('Изтриването не бе успешно: ' + err.message);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Council members (+ committee membership management)
  // ---------------------------------------------------------------------

  async function loadCouncilMembers() {
    const tbody = document.getElementById('council-members-tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Зареждане...</td></tr>';
    try {
      // Always refreshed (not just when empty) so a committee created or
      // approved elsewhere shows up in the membership-assignment <select>
      // without requiring a full page reload -- see committeeOptionsCache's
      // own comment for why this is kept separate from the Committees tab's
      // own status-filtered cache.
      await refreshCommitteeOptions();

      const status = statusByEntity['council-members'];
      const data = await fetchJson(
        `/api/admin/council-members?status=${encodeURIComponent(status)}`
      );
      councilMembersCache = (data && data.council_members) || [];
      renderCouncilMembers();
      if (membershipPanelMemberId) {
        const stillThere = councilMembersCache.find(
          (m) => String(m.id) === String(membershipPanelMemberId)
        );
        if (stillThere) renderMembershipPanel(stillThere);
        else closeMembershipPanel();
      }
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Грешка при зареждане.</td></tr>';
    }
  }

  function renderCouncilMembers() {
    const tbody = document.getElementById('council-members-tbody');
    if (councilMembersCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Няма записи в тази категория.</td></tr>';
      return;
    }
    tbody.innerHTML = councilMembersCache
      .map((row) => {
        const isPending = row.review_status === 'pending';
        const memberships = row.committee_memberships || [];
        const committeesSummary = memberships.length
          ? memberships.map((m) => escapeHtml(m.committee_name)).join(', ')
          : '&mdash;';
        return `
          <tr data-id="${row.id}">
            <td>${statusBadge(row.review_status)}</td>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.party) || '&mdash;'}</td>
            <td>${committeesSummary}</td>
            <td>
              <div class="row-actions">
                ${isPending ? `<button type="button" class="btn-approve" data-action="approve">Одобри</button><button type="button" class="btn-reject" data-action="reject">Отхвърли</button>` : ''}
                <button type="button" class="btn-secondary" data-action="edit">Редакция</button>
                <button type="button" class="btn-secondary" data-action="memberships">Комисии</button>
                <button type="button" class="btn-danger" data-action="delete">Изтрий</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function openCouncilMemberForm(row) {
    const panel = document.getElementById('council-member-form-panel');
    const title = document.getElementById('council-member-form-title');
    const errorBox = document.getElementById('council-member-form-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    document.getElementById('council-member-id').value = row ? row.id : '';
    document.getElementById('council-member-name').value = row ? row.name || '' : '';
    document.getElementById('council-member-party').value = row ? row.party || '' : '';

    title.textContent = row ? 'Редактиране на съветник' : 'Нов съветник';
    panel.classList.add('open');
    document.getElementById('council-member-name').focus();
  }

  function closeCouncilMemberForm() {
    document.getElementById('council-member-form-panel').classList.remove('open');
    document.getElementById('council-member-form').reset();
  }

  async function handleCouncilMemberFormSubmit(event) {
    event.preventDefault();
    const errorBox = document.getElementById('council-member-form-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    const id = document.getElementById('council-member-id').value;
    const body = {
      name: document.getElementById('council-member-name').value.trim(),
      party: document.getElementById('council-member-party').value.trim() || null,
    };

    try {
      if (id) {
        await fetchJson(`/api/council-members/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetchJson('/api/council-members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      closeCouncilMemberForm();
      await loadCouncilMembers();
    } catch (err) {
      errorBox.textContent = extractErrorMessage(err);
      errorBox.classList.add('visible');
    }
  }

  async function handleCouncilMembersTableClick(event) {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const row = btn.closest('tr');
    const id = row.getAttribute('data-id');
    const action = btn.getAttribute('data-action');

    if (action === 'approve' || action === 'reject') {
      btn.disabled = true;
      try {
        await reviewAction('council_members', id, action);
        await loadCouncilMembers();
      } catch (err) {
        alert('Действието не бе успешно: ' + err.message);
        btn.disabled = false;
      }
      return;
    }
    if (action === 'edit') {
      const item = councilMembersCache.find((r) => String(r.id) === String(id));
      if (item) openCouncilMemberForm(item);
      return;
    }
    if (action === 'memberships') {
      const item = councilMembersCache.find((r) => String(r.id) === String(id));
      if (item) {
        membershipPanelMemberId = item.id;
        renderMembershipPanel(item);
      }
      return;
    }
    if (action === 'delete') {
      if (!confirm('Сигурни ли сте, че искате да изтриете този съветник? Това ще премахне и всичките му членства в комисии.'))
        return;
      try {
        await fetchJson(`/api/council-members/${id}`, { method: 'DELETE' });
        if (String(membershipPanelMemberId) === String(id)) closeMembershipPanel();
        await loadCouncilMembers();
      } catch (err) {
        alert('Изтриването не бе успешно: ' + err.message);
      }
    }
  }

  // -- membership sub-panel ------------------------------------------------

  function populateCommitteeSelect() {
    const select = document.getElementById('membership-committee-select');
    select.innerHTML = committeeOptionsCache
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join('');
  }

  async function refreshCommitteeOptions() {
    try {
      const data = await fetchJson('/api/admin/committees?status=all');
      committeeOptionsCache = (data && data.committees) || [];
      populateCommitteeSelect();
    } catch (err) {
      // Leave whatever options were already populated.
    }
  }

  function renderMembershipPanel(member) {
    const panel = document.getElementById('membership-panel');
    const errorBox = document.getElementById('membership-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    document.getElementById('membership-member-name').textContent = member.name;

    const memberships = member.committee_memberships || [];
    const listEl = document.getElementById('membership-current-list');
    listEl.innerHTML = memberships.length
      ? memberships
          .map((m) => {
            const isChair = m.role && /председател/i.test(m.role);
            return `
              <span class="committee-chip-sm${isChair ? ' chair' : ''}" data-membership-id="${m.id}">
                ${escapeHtml(m.committee_name)}${m.role ? ` (${escapeHtml(m.role)})` : ''}
                <button type="button" data-remove-membership="${m.id}" title="Премахни">&times;</button>
              </span>
            `;
          })
          .join('')
      : '<span class="text-muted">Няма назначени комисии.</span>';

    panel.classList.add('open');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeMembershipPanel() {
    membershipPanelMemberId = null;
    document.getElementById('membership-panel').classList.remove('open');
  }

  async function handleMembershipAdd() {
    if (!membershipPanelMemberId) return;
    const errorBox = document.getElementById('membership-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    const committeeId = document.getElementById('membership-committee-select').value;
    const role = document.getElementById('membership-role-input').value.trim() || null;

    if (!committeeId) {
      errorBox.textContent = 'Изберете комисия.';
      errorBox.classList.add('visible');
      return;
    }

    try {
      await fetchJson('/api/committee-memberships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          council_member_id: membershipPanelMemberId,
          committee_id: Number(committeeId),
          role,
        }),
      });
      document.getElementById('membership-role-input').value = '';
      await loadCouncilMembers();
    } catch (err) {
      errorBox.textContent = extractErrorMessage(err);
      errorBox.classList.add('visible');
    }
  }

  async function handleMembershipListClick(event) {
    const btn = event.target.closest('button[data-remove-membership]');
    if (!btn) return;
    const membershipId = btn.getAttribute('data-remove-membership');
    btn.disabled = true;
    try {
      await fetchJson(`/api/committee-memberships/${membershipId}`, { method: 'DELETE' });
      await loadCouncilMembers();
    } catch (err) {
      alert('Премахването не бе успешно: ' + err.message);
      btn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------
  // Committees
  // ---------------------------------------------------------------------

  async function loadCommittees() {
    const tbody = document.getElementById('committees-tbody');
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">Зареждане...</td></tr>';
    try {
      const status = statusByEntity.committees;
      const data = await fetchJson(`/api/admin/committees?status=${encodeURIComponent(status)}`);
      committeesCache = (data && data.committees) || [];
      renderCommittees();
      await refreshCommitteeOptions();
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-state">Грешка при зареждане.</td></tr>';
    }
  }

  function renderCommittees() {
    const tbody = document.getElementById('committees-tbody');
    if (committeesCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-state">Няма записи в тази категория.</td></tr>';
      return;
    }
    tbody.innerHTML = committeesCache
      .map((row) => {
        const isPending = row.review_status === 'pending';
        return `
          <tr data-id="${row.id}">
            <td>${statusBadge(row.review_status)}</td>
            <td>${escapeHtml(row.name)}</td>
            <td>
              <div class="row-actions">
                ${isPending ? `<button type="button" class="btn-approve" data-action="approve">Одобри</button><button type="button" class="btn-reject" data-action="reject">Отхвърли</button>` : ''}
                <button type="button" class="btn-secondary" data-action="edit">Редакция</button>
                <button type="button" class="btn-danger" data-action="delete">Изтрий</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  function openCommitteeForm(row) {
    const panel = document.getElementById('committee-form-panel');
    const title = document.getElementById('committee-form-title');
    const errorBox = document.getElementById('committee-form-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    document.getElementById('committee-id').value = row ? row.id : '';
    document.getElementById('committee-name').value = row ? row.name || '' : '';

    title.textContent = row ? 'Редактиране на комисия' : 'Нова комисия';
    panel.classList.add('open');
    document.getElementById('committee-name').focus();
  }

  function closeCommitteeForm() {
    document.getElementById('committee-form-panel').classList.remove('open');
    document.getElementById('committee-form').reset();
  }

  async function handleCommitteeFormSubmit(event) {
    event.preventDefault();
    const errorBox = document.getElementById('committee-form-error');
    errorBox.classList.remove('visible');
    errorBox.textContent = '';

    const id = document.getElementById('committee-id').value;
    const body = { name: document.getElementById('committee-name').value.trim() };

    try {
      if (id) {
        await fetchJson(`/api/committees/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetchJson('/api/committees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      closeCommitteeForm();
      await loadCommittees();
    } catch (err) {
      errorBox.textContent = extractErrorMessage(err);
      errorBox.classList.add('visible');
    }
  }

  async function handleCommitteesTableClick(event) {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const row = btn.closest('tr');
    const id = row.getAttribute('data-id');
    const action = btn.getAttribute('data-action');

    if (action === 'approve' || action === 'reject') {
      btn.disabled = true;
      try {
        await reviewAction('committees', id, action);
        await loadCommittees();
      } catch (err) {
        alert('Действието не бе успешно: ' + err.message);
        btn.disabled = false;
      }
      return;
    }
    if (action === 'edit') {
      const item = committeesCache.find((r) => String(r.id) === String(id));
      if (item) openCommitteeForm(item);
      return;
    }
    if (action === 'delete') {
      if (!confirm('Сигурни ли сте, че искате да изтриете тази комисия? Това ще премахне и всички членства в нея.'))
        return;
      try {
        await fetchJson(`/api/committees/${id}`, { method: 'DELETE' });
        await loadCommittees();
      } catch (err) {
        alert('Изтриването не бе успешно: ' + err.message);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  function initAdminAdministrationPage() {
    document.getElementById('entity-tabs').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-entity]');
      if (!btn) return;
      switchEntityTab(btn.getAttribute('data-entity'));
    });

    document.querySelectorAll('.status-tabs').forEach((el) => {
      el.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-status]');
        if (!btn) return;
        const scope = el.getAttribute('data-scope');
        statusByEntity[scope] = btn.getAttribute('data-status');
        el.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
        loadCurrentEntity();
      });
    });

    // Departments
    document.getElementById('departments-tbody').addEventListener('click', handleDepartmentsTableClick);
    document.getElementById('new-department-btn').addEventListener('click', () => openDepartmentForm(null));
    document.getElementById('department-form-cancel').addEventListener('click', closeDepartmentForm);
    document.getElementById('department-form').addEventListener('submit', handleDepartmentFormSubmit);

    // Officials
    document.getElementById('officials-tbody').addEventListener('click', handleOfficialsTableClick);
    document.getElementById('new-official-btn').addEventListener('click', () => openOfficialForm(null));
    document.getElementById('official-form-cancel').addEventListener('click', closeOfficialForm);
    document.getElementById('official-form').addEventListener('submit', handleOfficialFormSubmit);

    // Council members
    document.getElementById('council-members-tbody').addEventListener('click', handleCouncilMembersTableClick);
    document.getElementById('new-council-member-btn').addEventListener('click', () => openCouncilMemberForm(null));
    document.getElementById('council-member-form-cancel').addEventListener('click', closeCouncilMemberForm);
    document.getElementById('council-member-form').addEventListener('submit', handleCouncilMemberFormSubmit);
    document.getElementById('membership-panel-close').addEventListener('click', closeMembershipPanel);
    document.getElementById('membership-add-btn').addEventListener('click', handleMembershipAdd);
    document.getElementById('membership-current-list').addEventListener('click', handleMembershipListClick);

    // Committees
    document.getElementById('committees-tbody').addEventListener('click', handleCommitteesTableClick);
    document.getElementById('new-committee-btn').addEventListener('click', () => openCommitteeForm(null));
    document.getElementById('committee-form-cancel').addEventListener('click', closeCommitteeForm);
    document.getElementById('committee-form').addEventListener('submit', handleCommitteeFormSubmit);

    loadDepartments();
  }

  window.initAdminAdministrationPage = initAdminAdministrationPage;
})(window);
