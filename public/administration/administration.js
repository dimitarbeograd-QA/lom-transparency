/*
 * Community Лом -- Public "Общинска администрация" (Administration &
 * Contacts) page. Plain script, no bundler -- relies on /js/common.js being
 * loaded first for fetchJson/formatDate/renderSourceBadge/renderNav.
 */

(function (window) {
  'use strict';

  // All department/official/council-member/committee fields ultimately come
  // from either scraped third-party HTML content or admin form input --
  // neither is trusted enough to interpolate into innerHTML unescaped.
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderDepartmentCard(dept, officials) {
    const deptOfficials = officials.filter((o) => o.department_id === dept.id);

    const officialsHtml = deptOfficials.length
      ? deptOfficials
          .map((o) => {
            const contacts = [];
            if (o.phone) contacts.push(`тел: ${escapeHtml(o.phone)}`);
            if (o.email)
              contacts.push(
                `<a href="mailto:${escapeHtml(o.email)}">${escapeHtml(o.email)}</a>`
              );
            return `
              <div class="official-item">
                <div class="official-name">${escapeHtml(o.name)}</div>
                ${o.position ? `<div class="official-position">${escapeHtml(o.position)}</div>` : ''}
                ${contacts.length ? `<div class="official-contacts">${contacts.join(' &middot; ')}</div>` : ''}
              </div>
            `;
          })
          .join('')
      : '<p class="text-muted" style="margin:0;">Няма добавени контакти в тази секция.</p>';

    return `
      <div class="card department-card">
        <h3>${escapeHtml(dept.name)}</h3>
        ${dept.description ? `<p class="department-desc">${escapeHtml(dept.description)}</p>` : ''}
        ${officialsHtml}
        ${renderSourceBadge(dept.source_url, dept.scraped_at)}
      </div>
    `;
  }

  function renderCouncilMemberCard(member) {
    const memberships = member.committee_memberships || [];
    const chipsHtml = memberships.length
      ? memberships
          .map((m) => {
            const isChair = m.role && /председател/i.test(m.role);
            return `<span class="committee-chip${isChair ? ' chair' : ''}">${escapeHtml(m.committee_name)}${isChair ? ' (Председател)' : ''}</span>`;
          })
          .join('')
      : '';

    return `
      <div class="council-member-card">
        <div class="council-member-name">${escapeHtml(member.name)}</div>
        ${member.party ? `<div class="text-muted" style="font-size:0.85rem;">${escapeHtml(member.party)}</div>` : ''}
        ${chipsHtml ? `<div style="margin-top:0.4rem;">${chipsHtml}</div>` : ''}
      </div>
    `;
  }

  function renderCommitteeCard(committee, councilMembers) {
    // Find members of this committee by cross-referencing every council
    // member's own embedded committee_memberships list (the public
    // /council-members response is the only place membership+role data is
    // exposed).
    const rows = [];
    councilMembers.forEach((member) => {
      (member.committee_memberships || []).forEach((m) => {
        if (m.committee_id === committee.id) {
          rows.push({ name: member.name, role: m.role });
        }
      });
    });

    rows.sort((a, b) => {
      const aChair = a.role && /председател/i.test(a.role) ? 0 : 1;
      const bChair = b.role && /председател/i.test(b.role) ? 0 : 1;
      if (aChair !== bChair) return aChair - bChair;
      return a.name.localeCompare(b.name, 'bg');
    });

    const listHtml = rows.length
      ? `<ul>${rows
          .map((r) => {
            const isChair = r.role && /председател/i.test(r.role);
            return `<li${isChair ? ' class="chair"' : ''}>${escapeHtml(r.name)}${isChair ? ' — председател' : ''}</li>`;
          })
          .join('')}</ul>`
      : '<p class="text-muted" style="margin:0;">Няма одобрени членове все още.</p>';

    return `
      <div class="card committee-card">
        <h3>${escapeHtml(committee.name)}</h3>
        ${listHtml}
        ${renderSourceBadge(committee.source_url, committee.scraped_at)}
      </div>
    `;
  }

  async function initAdministrationPage() {
    const deptContainer = document.getElementById('departments-list');
    const councilContainer = document.getElementById('council-members-list');
    const committeesContainer = document.getElementById('committees-list');

    let departments = [];
    let officials = [];
    let councilMembers = [];
    let committees = [];

    try {
      const [deptData, offData, memberData, committeeData] = await Promise.all([
        fetchJson('/api/departments'),
        fetchJson('/api/officials'),
        fetchJson('/api/council-members'),
        fetchJson('/api/committees'),
      ]);
      departments = (deptData && deptData.departments) || [];
      officials = (offData && offData.officials) || [];
      councilMembers = (memberData && memberData.council_members) || [];
      committees = (committeeData && committeeData.committees) || [];
    } catch (err) {
      deptContainer.innerHTML =
        '<p class="empty-state">Грешка при зареждане на данните. Опитайте отново по-късно.</p>';
      councilContainer.innerHTML = '';
      committeesContainer.innerHTML = '';
      return;
    }

    // -- Departments / contacts --------------------------------------------
    if (departments.length === 0) {
      deptContainer.innerHTML =
        '<p class="empty-state">Все още няма одобрени данни за администрацията.</p>';
    } else {
      deptContainer.innerHTML = departments
        .map((d) => renderDepartmentCard(d, officials))
        .join('');
    }

    // Officials with no department at all (edge case, but keep them visible).
    const unassigned = officials.filter(
      (o) => !departments.some((d) => d.id === o.department_id)
    );
    if (unassigned.length > 0) {
      deptContainer.innerHTML += renderDepartmentCard(
        { id: null, name: 'Други контакти', description: null, source_url: null, scraped_at: null },
        unassigned
      );
    }

    // -- Council members, grouped by party ----------------------------------
    if (councilMembers.length === 0) {
      councilContainer.innerHTML =
        '<p class="empty-state">Все още няма одобрени съветници.</p>';
    } else {
      const byParty = new Map();
      councilMembers.forEach((m) => {
        const key = m.party || 'Без посочена партия/коалиция';
        if (!byParty.has(key)) byParty.set(key, []);
        byParty.get(key).push(m);
      });

      let html = '';
      byParty.forEach((members, party) => {
        members.sort((a, b) => a.name.localeCompare(b.name, 'bg'));
        html += `
          <div class="party-group">
            <h3>${escapeHtml(party)}</h3>
            <div class="council-member-grid">
              ${members.map(renderCouncilMemberCard).join('')}
            </div>
          </div>
        `;
      });
      councilContainer.innerHTML = html;
    }

    // -- Committees -----------------------------------------------------------
    if (committees.length === 0) {
      committeesContainer.innerHTML =
        '<p class="empty-state">Все още няма одобрени комисии.</p>';
    } else {
      committeesContainer.innerHTML = committees
        .map((c) => renderCommitteeCard(c, councilMembers))
        .join('');
    }
  }

  window.initAdministrationPage = initAdministrationPage;
})(window);
