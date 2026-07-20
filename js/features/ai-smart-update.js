(() => {
  'use strict';

  const MAX_MATCHES = 50;
  const MAX_CONTEXT_LESSONS = 500;
  const normalise = value => String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const timeShort = value => String(value || '').slice(0, 5);
  const $id = id => document.getElementById(id);
  let pendingActions = [];
  let conversation = [];

  function teacherByName(name) {
    const wanted = normalise(name);
    if (!wanted) return null;
    return profiles.find(person => normalise(person.display_name) === wanted) ||
      profiles.find(person => normalise(person.display_name).includes(wanted) || wanted.includes(normalise(person.display_name))) || null;
  }

  function teacherName(id) {
    return profiles.find(person => person.id === id)?.display_name || 'Unknown teacher';
  }

  function escHtml(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  function formatLesson(lesson) {
    return `${teacherName(lesson.teacher_id)} · ${lesson.lesson_date} · ${timeShort(lesson.start_time)}–${timeShort(lesson.end_time)} · ${lesson.school || ''}${lesson.class_name ? ' · ' + lesson.class_name : ''}${lesson.activity ? ' · ' + lesson.activity : ''}`;
  }

  function renderLessonCard(lesson, heading = '') {
    return `<article class="ai-change-card">${heading ? `<div class="ai-change-title">${escHtml(heading)}</div>` : ''}<div>${escHtml(teacherName(lesson.teacher_id))}</div><div class="ai-change-meta">${escHtml(lesson.lesson_date)} · ${escHtml(timeShort(lesson.start_time))}–${escHtml(timeShort(lesson.end_time))}</div><div class="ai-change-meta">${escHtml(lesson.school || '')}${lesson.class_name ? ' · ' + escHtml(lesson.class_name) : ''}${lesson.activity ? ' · ' + escHtml(lesson.activity) : ''}</div></article>`;
  }

  function addMessage(role, html, label = '') {
    const chat = $id('aiChat');
    const item = document.createElement('div');
    item.className = `ai-message ${role}`;
    const avatar = role === 'user' ? 'G' : '✦';
    const name = label || (role === 'user' ? 'You' : 'Music Delight AI');
    item.innerHTML = `<div class="ai-avatar" aria-hidden="true">${avatar}</div><div class="ai-message-body"><div class="ai-message-meta"><span>${escHtml(name)}</span><time>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><div class="ai-bubble">${html}</div></div>`;
    chat.appendChild(item);
    chat.scrollTop = chat.scrollHeight;
  }

  function setBusyState(state) {
    const send = $id('aiSend');
    const input = $id('aiInput');
    if (send) {
      send.disabled = state;
      send.textContent = state ? 'Thinking…' : 'Send';
    }
    if (input) input.disabled = state;
  }

  function todayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function compactLesson(lesson) {
    return {
      id: lesson.id,
      teacher: teacherName(lesson.teacher_id),
      date: lesson.lesson_date,
      start_time: timeShort(lesson.start_time),
      end_time: timeShort(lesson.end_time),
      school: lesson.school || '',
      class_name: lesson.class_name || '',
      activity: lesson.activity || '',
      status: lesson.status || ''
    };
  }

  async function askCalendarAI(message) {
    const body = {
      message,
      today: todayIso(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Singapore',
      teachers: profiles.map(person => person.display_name),
      lessons: lessons.slice(0, MAX_CONTEXT_LESSONS).map(compactLesson),
      conversation: conversation.slice(-6)
    };
    const { data, error } = await sb.functions.invoke('calendar-ai', { body });
    if (error) {
      let text = error.message || 'AI request failed.';
      try {
        const details = await error.context.json();
        text = details.error || text;
      } catch (_) {}
      throw new Error(text);
    }
    if (!data?.result) throw new Error('The AI returned no calendar instruction.');
    return data.result;
  }

  function matches(result) {
    const teacher = result.teacher ? teacherByName(result.teacher) : null;
    const school = normalise(result.school);
    const activity = normalise(result.activity);
    const className = normalise(result.class_name);
    const status = normalise(result.status);
    return lessons.filter(lesson => {
      if (result.teacher && (!teacher || lesson.teacher_id !== teacher.id)) return false;
      if (result.date && lesson.lesson_date !== result.date) return false;
      if (result.date_from && lesson.lesson_date < result.date_from) return false;
      if (result.date_to && lesson.lesson_date > result.date_to) return false;
      if (result.start_time && timeShort(lesson.start_time) !== timeShort(result.start_time)) return false;
      if (result.end_time && timeShort(lesson.end_time) !== timeShort(result.end_time)) return false;
      if (school && !normalise(lesson.school).includes(school)) return false;
      if (activity && !normalise(lesson.activity).includes(activity)) return false;
      if (className && !normalise(lesson.class_name).includes(className)) return false;
      if (status && normalise(lesson.status) !== status) return false;
      return true;
    });
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return timeShort(aStart) < timeShort(bEnd) && timeShort(bStart) < timeShort(aEnd);
  }

  function conflictsFor(candidate, ignoredIds = []) {
    return lessons.filter(lesson =>
      !ignoredIds.includes(lesson.id) &&
      lesson.teacher_id === candidate.teacher_id &&
      lesson.lesson_date === candidate.lesson_date &&
      overlaps(candidate.start_time, candidate.end_time, lesson.start_time, lesson.end_time)
    );
  }

  function durationMinutes(found) {
    return found.reduce((sum, lesson) => {
      const [sh, sm] = timeShort(lesson.start_time).split(':').map(Number);
      const [eh, em] = timeShort(lesson.end_time).split(':').map(Number);
      return sum + Math.max(0, eh * 60 + em - sh * 60 - sm);
    }, 0);
  }

  function queryResponse(result, found) {
    if (result.query_mode === 'free_teachers') {
      const date = result.date;
      if (!date) return 'Please specify the date you want me to check.';
      const busyTeacherIds = new Set(lessons.filter(item => item.lesson_date === date).map(item => item.teacher_id));
      const free = profiles.filter(person => !busyTeacherIds.has(person.id));
      return free.length
        ? `<b>${free.length} teacher${free.length === 1 ? '' : 's'} have no lessons on ${escHtml(date)}:</b><br>${free.map(person => escHtml(person.display_name)).join(', ')}`
        : `Every active teacher has at least one lesson on ${escHtml(date)}.`;
    }

    if (result.query_mode === 'teacher_load') {
      const totals = new Map(profiles.map(person => [person.id, 0]));
      found.forEach(item => totals.set(item.teacher_id, (totals.get(item.teacher_id) || 0) + durationMinutes([item])));
      const rows = [...totals.entries()].filter(([, minutes]) => minutes > 0).sort((a, b) => b[1] - a[1]);
      return rows.length
        ? `<b>Teaching load</b><div class="ai-results">${rows.map(([id, minutes]) => `<div>${escHtml(teacherName(id))}: ${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)} hours</div>`).join('')}</div>`
        : 'No lessons were found for that period.';
    }

    if (result.query_mode === 'conflicts') {
      const clashes = [];
      found.forEach((lesson, index) => {
        found.slice(index + 1).forEach(other => {
          if (lesson.teacher_id === other.teacher_id && lesson.lesson_date === other.lesson_date && overlaps(lesson.start_time, lesson.end_time, other.start_time, other.end_time)) clashes.push([lesson, other]);
        });
      });
      return clashes.length
        ? `<b>${clashes.length} possible conflict${clashes.length === 1 ? '' : 's'} found.</b>${clashes.slice(0, 20).map(pair => `<div class="ai-conflict">⚠ ${escHtml(formatLesson(pair[0]))}<br>and ${escHtml(formatLesson(pair[1]))}</div>`).join('')}`
        : '✓ No teacher scheduling conflicts were found in the selected lessons.';
    }

    const total = durationMinutes(found);
    if (!found.length) return '<div class="ai-empty-state"><div class="ai-empty-icon">⌕</div><b>No matching lessons</b><span>Try including a teacher, date, school, class or activity.</span></div>';
    const schools = new Set(found.map(item => item.school).filter(Boolean)).size;
    const rows = found.slice(0, 50).map(item => `<tr><td>${escHtml(item.lesson_date)}</td><td>${escHtml(timeShort(item.start_time))}–${escHtml(timeShort(item.end_time))}</td><td>${escHtml(teacherName(item.teacher_id))}</td><td>${escHtml(item.school || '—')}</td><td>${escHtml(item.class_name || item.activity || '—')}</td></tr>`).join('');
    return `<div class="ai-result-summary"><div><span>Lessons</span><b>${found.length}</b></div><div><span>Total hours</span><b>${(total / 60).toFixed(total % 60 ? 1 : 0)}</b></div><div><span>Schools</span><b>${schools}</b></div></div><div class="ai-table-wrap"><table class="ai-result-table"><thead><tr><th>Date</th><th>Time</th><th>Teacher</th><th>School</th><th>Class / Activity</th></tr></thead><tbody>${rows}</tbody></table></div>${found.length > 50 ? '<div class="ai-result-note">Showing the first 50 lessons.</div>' : ''}`;
  }

  function renderPending(title, body, confirmLabel) {
    addMessage('assistant', `<div class="ai-proposal"><div class="ai-proposal-heading">${escHtml(title)}</div>${body}<div class="ai-proposal-actions"><button type="button" id="aiConfirmAction" class="btn primary">${escHtml(confirmLabel)}</button><button type="button" id="aiCancelAction" class="btn">Cancel</button></div></div>`);
    $id('aiConfirmAction').onclick = applyPending;
    $id('aiCancelAction').onclick = () => {
      pendingActions = [];
      addMessage('assistant', 'Cancelled. No calendar changes were made.');
    };
  }

  async function handleResult(result) {
    if (result.action === 'clarification') {
      addMessage('assistant', escHtml(result.clarification_question || 'Please provide more details.'));
      return;
    }

    if (result.action === 'query') {
      const found = matches(result);
      addMessage('assistant', queryResponse(result, found));
      return;
    }

    if (result.action === 'add') {
      const teacher = teacherByName(result.teacher);
      if (!teacher) throw new Error(`Teacher “${result.teacher || ''}” was not found.`);
      if (!result.date || !result.start_time || !result.end_time || !result.school || !result.activity) throw new Error('The AI response is missing lesson details.');
      const payload = {
        teacher_id: teacher.id,
        lesson_date: result.date,
        start_time: result.start_time,
        end_time: result.end_time,
        school: result.school,
        class_name: result.class_name || null,
        activity: result.activity,
        status: result.status || 'Confirmed',
        notes: 'Added through Music Delight AI',
        created_by: session.user.id
      };
      const conflicts = conflictsFor(payload);
      pendingActions = [{ type: 'add', payload }];
      const warning = conflicts.length ? `<div class="ai-warning">⚠ ${conflicts.length} overlapping teacher lesson${conflicts.length === 1 ? '' : 's'} found.${conflicts.map(item => renderLessonCard(item)).join('')}</div>` : '<div class="ai-safe">✓ No teacher conflict found.</div>';
      renderPending('Add lesson', renderLessonCard(payload) + warning + `<p>${escHtml(result.confirmation_message || 'Review and confirm this lesson.')}</p>`, conflicts.length ? 'Add anyway' : 'Confirm add');
      return;
    }

    const found = matches(result);
    if (!found.length) throw new Error('No matching lessons were found. Include a teacher, date, school, activity or time.');
    if (found.length > MAX_MATCHES) throw new Error(`This request would affect ${found.length} lessons. Narrow it to ${MAX_MATCHES} or fewer.`);

    if (result.action === 'delete') {
      pendingActions = found.map(lesson => ({ type: 'delete', id: lesson.id, before: lesson }));
      renderPending(`Delete ${found.length} lesson${found.length === 1 ? '' : 's'}`, '<div class="ai-warning">This cannot be undone yet.</div>' + found.map(item => renderLessonCard(item)).join(''), `Confirm delete (${found.length})`);
      return;
    }

    if (result.action === 'update') {
      const changes = result.requested_changes || {};
      const replacementName = result.replacement_teacher || changes.teacher;
      const replacement = replacementName ? teacherByName(replacementName) : null;
      if (replacementName && !replacement) throw new Error(`Replacement teacher “${replacementName}” was not found.`);
      const ignoredIds = found.map(item => item.id);
      let conflictCount = 0;
      pendingActions = found.map(lesson => {
        const patch = {};
        if (replacement) patch.teacher_id = replacement.id;
        if (changes.date) patch.lesson_date = changes.date;
        if (changes.start_time) patch.start_time = changes.start_time;
        if (changes.end_time) patch.end_time = changes.end_time;
        if (changes.school) patch.school = changes.school;
        if (changes.activity) patch.activity = changes.activity;
        if (changes.class_name !== null && changes.class_name !== undefined && changes.class_name !== '') patch.class_name = changes.class_name;
        if (changes.status) patch.status = changes.status;
        const after = { ...lesson, ...patch };
        conflictCount += conflictsFor(after, ignoredIds).length;
        return { type: 'update', id: lesson.id, before: lesson, patch, after };
      });
      if (!pendingActions.some(item => Object.keys(item.patch).length)) throw new Error('The AI did not identify any new details to apply.');
      const cards = pendingActions.map(item => `<div class="ai-before-after"><div>${renderLessonCard(item.before, 'Current')}</div><div class="ai-arrow">→</div><div>${renderLessonCard(item.after, 'New')}</div></div>`).join('');
      const warning = conflictCount ? `<div class="ai-warning">⚠ ${conflictCount} possible teacher conflict${conflictCount === 1 ? '' : 's'} detected.</div>` : '<div class="ai-safe">✓ No teacher conflicts found.</div>';
      renderPending(`Update ${found.length} lesson${found.length === 1 ? '' : 's'}`, warning + cards, conflictCount ? 'Update anyway' : `Confirm update (${found.length})`);
      return;
    }

    throw new Error(`The action “${result.action}” is not supported.`);
  }

  async function applyPending() {
    if (!pendingActions.length) return;
    const confirmButton = $id('aiConfirmAction');
    if (confirmButton) confirmButton.disabled = true;
    busy(true);
    try {
      for (const action of pendingActions) {
        let response;
        if (action.type === 'add') response = await sb.from('lessons').insert(action.payload);
        if (action.type === 'update') response = await sb.from('lessons').update(action.patch).eq('id', action.id);
        if (action.type === 'delete') response = await sb.from('lessons').delete().eq('id', action.id);
        if (response?.error) throw response.error;
      }
      const count = pendingActions.length;
      const type = pendingActions[0].type;
      pendingActions = [];
      await loadLessons();
      addMessage('assistant', `✓ ${count} lesson${count === 1 ? '' : 's'} ${type === 'delete' ? 'deleted' : type === 'update' ? 'updated' : 'added'} successfully.`);
      toast('Calendar updated.');
    } catch (error) {
      addMessage('assistant', `<span class="ai-error">${escHtml(error.message || 'The calendar update failed.')}</span>`);
    } finally {
      busy(false);
      if (confirmButton) confirmButton.disabled = false;
    }
  }

  async function sendMessage() {
    const input = $id('aiInput');
    const message = input.value.trim();
    if (!message) return;
    pendingActions = [];
    input.value = '';
    addMessage('user', escHtml(message));
    conversation.push({ role: 'user', content: message });
    setBusyState(true);
    try {
      const result = await askCalendarAI(message);
      conversation.push({ role: 'assistant', content: JSON.stringify(result) });
      await handleResult(result);
    } catch (error) {
      addMessage('assistant', `<span class="ai-error">${escHtml(error.message)}</span>`);
    } finally {
      setBusyState(false);
      input.focus();
    }
  }

  function buildAssistant() {
    const dialog = $id('smartDialog');
    if (!dialog) return;
    dialog.classList.add('ai-dialog');
    dialog.innerHTML = `
      <div class="ai-panel">
        <header class="ai-header">
          <div class="ai-brand-block">
            <div class="ai-logo" aria-hidden="true">✦</div>
            <div><div class="ai-title-row"><h2>Music Delight AI</h2><span class="ai-beta">BETA</span></div><p>Your assistant for the Music Delight Calendar</p></div>
          </div>
          <div class="ai-header-actions">
            <button type="button" id="aiClear" class="ai-icon-btn" aria-label="Clear conversation" title="Clear conversation">↻</button>
            <button type="button" id="aiClose" class="ai-icon-btn" aria-label="Close">✕</button>
          </div>
        </header>
        <div class="ai-workspace">
          <main class="ai-main-column">
            <div id="aiChat" class="ai-chat" aria-live="polite"></div>
            <div class="ai-prompt-chips" aria-label="Suggested prompts">
              <button type="button" data-prompt="Show all lessons tomorrow">Tomorrow's lessons</button>
              <button type="button" data-prompt="Find teacher conflicts this month">Find conflicts</button>
              <button type="button" data-prompt="Who is free tomorrow?">Who is free?</button>
              <button type="button" data-prompt="Show total teaching hours this month">Teaching hours</button>
            </div>
            <div class="ai-composer-wrap">
              <div class="ai-composer">
                <textarea id="aiInput" rows="2" placeholder="Ask anything about your calendar…"></textarea>
                <button type="button" id="aiSend" class="ai-send-btn" aria-label="Send message">➤</button>
              </div>
              <div class="ai-composer-actions">
                <button type="button" data-prompt="Add a lesson">＋ Add lesson</button>
                <button type="button" data-prompt="Move a lesson">⇄ Move lesson</button>
                <button type="button" data-prompt="Edit a lesson">✎ Edit lesson</button>
                <button type="button" data-prompt="Delete a lesson">⌫ Delete lesson</button>
              </div>
              <p class="ai-disclaimer">AI can make mistakes. Review every proposed change before confirming.</p>
            </div>
          </main>
          <aside class="ai-side-column">
            <section class="ai-side-card"><h3>Quick actions</h3><button data-prompt="Add a lesson"><span>＋</span><div><b>Add lesson</b><small>Create a new lesson</small></div><i>›</i></button><button data-prompt="Move a lesson"><span>⇄</span><div><b>Move lesson</b><small>Change date or time</small></div><i>›</i></button><button data-prompt="Replace a teacher"><span>♙</span><div><b>Replace teacher</b><small>Assign another teacher</small></div><i>›</i></button><button data-prompt="Delete a lesson"><span>⌫</span><div><b>Delete lesson</b><small>Remove lesson(s)</small></div><i>›</i></button></section>
            <section class="ai-side-card"><h3>Search & explore</h3><button data-prompt="Search lessons"><span>⌕</span><div><b>Search lessons</b><small>Find by teacher or school</small></div><i>›</i></button><button data-prompt="Who is free tomorrow?"><span>◷</span><div><b>Who is free?</b><small>Check availability</small></div><i>›</i></button><button data-prompt="Show total teaching hours this month"><span>◴</span><div><b>Teaching hours</b><small>Summarise teacher load</small></div><i>›</i></button></section>
          </aside>
        </div>
      </div>`;

    $id('aiClose').onclick = () => dialog.close();
    $id('aiClear').onclick = () => {
      pendingActions = [];
      conversation = [];
      $id('aiChat').innerHTML = '';
      addMessage('assistant', '<div class="ai-welcome"><b>How can I help?</b><span>I can search the calendar, calculate teaching hours, find clashes, or prepare lesson changes for confirmation.</span></div>');
    };
    $id('aiSend').onclick = sendMessage;
    $id('aiInput').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    dialog.querySelectorAll('[data-prompt]').forEach(button => {
      button.onclick = () => {
        $id('aiInput').value = button.dataset.prompt;
        sendMessage();
      };
    });

    const smartButton = $id('smartBtn');
    if (smartButton) smartButton.onclick = () => {
      pendingActions = [];
      conversation = [];
      $id('aiChat').innerHTML = '';
      addMessage('assistant', '<div class="ai-welcome"><b>Hi Gerald, how can I help?</b><span>I can search lessons, calculate teaching hours, check availability and prepare calendar changes. Nothing is saved until you confirm.</span></div>');
      dialog.showModal();
      setTimeout(() => $id('aiInput').focus(), 50);
    };
  }

  buildAssistant();
})();
