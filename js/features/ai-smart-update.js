(() => {
  const normalise = value => String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const timeShort = value => String(value || '').slice(0, 5);

  function teacherByName(name) {
    const wanted = normalise(name);
    return profiles.find(person => normalise(person.display_name) === wanted) || null;
  }

  function teacherName(id) {
    return profiles.find(person => person.id === id)?.display_name || 'Unknown teacher';
  }

  function lessonCard(lesson, heading = '') {
    return `<div class="preview-item">${heading ? `<b>${esc(heading)}</b><br>` : ''}${esc(teacherName(lesson.teacher_id))} · ${esc(lesson.lesson_date)} · ${esc(timeShort(lesson.start_time))}–${esc(timeShort(lesson.end_time))}<br>${esc(lesson.school || '')}${lesson.class_name ? ' · ' + esc(lesson.class_name) : ''}${lesson.activity ? ' · ' + esc(lesson.activity) : ''}</div>`;
  }

  function matches(result) {
    const teacher = result.teacher ? teacherByName(result.teacher) : null;
    const school = normalise(result.school);
    const activity = normalise(result.activity);
    const className = normalise(result.class_name);
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
      return true;
    });
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return timeShort(aStart) < timeShort(bEnd) && timeShort(bStart) < timeShort(aEnd);
  }

  function conflictsFor(candidate, ignoreIds = []) {
    return lessons.filter(lesson =>
      !ignoreIds.includes(lesson.id) &&
      lesson.teacher_id === candidate.teacher_id &&
      lesson.lesson_date === candidate.lesson_date &&
      overlaps(candidate.start_time, candidate.end_time, lesson.start_time, lesson.end_time)
    );
  }

  async function askCalendarAI(message) {
    const { data, error } = await sb.functions.invoke('calendar-ai', { body: { message } });
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

  function resetDialog() {
    smartActions = [];
    $('smartCommand').value = '';
    $('smartPreview').classList.add('hidden');
    $('smartPreview').innerHTML = '';
    $('smartConfirm').classList.add('hidden');
    $('smartError').textContent = '';
    $('smartParse').textContent = 'Ask AI';
  }

  const title = document.querySelector('#smartDialog h2');
  const intro = document.querySelector('#smartDialog > .muted');
  const examples = document.querySelector('#smartDialog .examples');
  if (title) title.textContent = 'Music Delight AI';
  if (intro) intro.textContent = 'Add, edit, move, delete or search lessons in normal English. Nothing changes until you confirm.';
  if (examples) examples.innerHTML = 'Examples:<br>Add Gerald tomorrow at Compassvale from 2pm to 5pm for Keyboard<br>Move Gerald’s Compassvale lesson tomorrow to 3pm<br>Change Joel to Wero next Friday<br>Delete all Joel lessons in August<br>Show Gerald lessons next week';

  $('smartBtn').onclick = () => {
    resetDialog();
    $('smartDialog').showModal();
  };
  $('smartCommand').oninput = () => {};

  $('smartParse').onclick = async () => {
    const message = $('smartCommand').value.trim();
    if (!message) return $('smartError').textContent = 'Enter a calendar instruction.';
    $('smartError').textContent = '';
    $('smartConfirm').classList.add('hidden');
    $('smartParse').disabled = true;
    $('smartParse').textContent = 'Thinking…';

    try {
      const result = await askCalendarAI(message);
      if (result.action === 'clarification') {
        $('smartError').textContent = result.clarification_question || 'Please provide more details.';
        return;
      }

      if (result.action === 'add') {
        const teacher = teacherByName(result.teacher);
        if (!teacher) throw new Error('Teacher not found in the calendar.');
        if (!result.date || !result.start_time || !result.end_time || !result.school || !result.activity) throw new Error('The AI response is missing lesson details.');
        const payload = {
          teacher_id: teacher.id,
          lesson_date: result.date,
          start_time: result.start_time,
          end_time: result.end_time,
          school: result.school,
          class_name: result.class_name || null,
          activity: result.activity,
          status: 'Confirmed',
          notes: 'Added through Music Delight AI',
          created_by: session.user.id
        };
        const conflicts = conflictsFor(payload);
        smartActions = [{ type: 'add', payload }];
        $('smartPreview').innerHTML = lessonCard(payload, 'Add lesson') +
          (conflicts.length ? `<div class="preview-item"><b>⚠ Schedule conflict</b><br>${conflicts.length} overlapping lesson${conflicts.length === 1 ? '' : 's'} found.${conflicts.map(x => lessonCard(x)).join('')}</div>` : '<div class="preview-item"><b>✓ No teacher conflict found</b></div>') +
          `<div class="preview-item">${esc(result.confirmation_message)}</div>`;
        $('smartConfirm').textContent = conflicts.length ? 'Confirm anyway' : 'Confirm add';
      } else {
        const found = matches(result);
        if (!found.length) throw new Error('No matching lessons were found. Try including the teacher, date, school or time.');

        if (result.action === 'query') {
          const totalMinutes = found.reduce((sum, lesson) => {
            const [sh, sm] = timeShort(lesson.start_time).split(':').map(Number);
            const [eh, em] = timeShort(lesson.end_time).split(':').map(Number);
            return sum + Math.max(0, eh * 60 + em - sh * 60 - sm);
          }, 0);
          $('smartPreview').innerHTML = `<div class="preview-item"><b>Found ${found.length} lesson${found.length === 1 ? '' : 's'}</b><br>Total duration: ${(totalMinutes / 60).toFixed(totalMinutes % 60 ? 1 : 0)} hours</div>` + found.slice(0, 50).map(x => lessonCard(x)).join('') + (found.length > 50 ? '<div class="preview-item">Only the first 50 results are shown.</div>' : '');
          smartActions = [];
          $('smartConfirm').classList.add('hidden');
          $('smartPreview').classList.remove('hidden');
          return;
        }

        if (found.length > 50) throw new Error(`This would affect ${found.length} lessons. Please narrow the request to 50 or fewer lessons.`);

        if (result.action === 'delete') {
          smartActions = found.map(lesson => ({ type: 'delete', id: lesson.id }));
          $('smartPreview').innerHTML = `<div class="preview-item"><b>Delete ${found.length} lesson${found.length === 1 ? '' : 's'}</b><br>This cannot be undone yet.</div>` + found.map(x => lessonCard(x)).join('') + `<div class="preview-item">${esc(result.confirmation_message)}</div>`;
          $('smartConfirm').textContent = `Confirm delete (${found.length})`;
        } else if (result.action === 'update') {
          const changes = result.requested_changes || {};
          const replacement = result.replacement_teacher ? teacherByName(result.replacement_teacher) : (changes.teacher ? teacherByName(changes.teacher) : null);
          if ((result.replacement_teacher || changes.teacher) && !replacement) throw new Error('Replacement teacher not found in the calendar.');
          const updates = found.map(lesson => {
            const patch = {};
            if (replacement) patch.teacher_id = replacement.id;
            if (changes.date) patch.lesson_date = changes.date;
            if (changes.start_time) patch.start_time = changes.start_time;
            if (changes.end_time) patch.end_time = changes.end_time;
            if (changes.school) patch.school = changes.school;
            if (changes.activity) patch.activity = changes.activity;
            if (changes.class_name) patch.class_name = changes.class_name;
            return { type: 'update', id: lesson.id, before: lesson, patch, after: { ...lesson, ...patch } };
          });
          if (!updates.some(item => Object.keys(item.patch).length)) throw new Error('The AI did not provide the new details for this update.');
          const conflictCount = updates.reduce((sum, item) => sum + conflictsFor(item.after, found.map(x => x.id)).length, 0);
          smartActions = updates;
          $('smartPreview').innerHTML = `<div class="preview-item"><b>Update ${found.length} lesson${found.length === 1 ? '' : 's'}</b>${conflictCount ? `<br>⚠ ${conflictCount} possible teacher conflict${conflictCount === 1 ? '' : 's'} detected.` : '<br>✓ No teacher conflicts found.'}</div>` + updates.map(item => lessonCard(item.before, 'Current') + lessonCard(item.after, 'New')).join('') + `<div class="preview-item">${esc(result.confirmation_message)}</div>`;
          $('smartConfirm').textContent = conflictCount ? 'Confirm anyway' : `Confirm update (${found.length})`;
        } else {
          throw new Error(`The action “${result.action}” is not supported yet.`);
        }
      }

      $('smartPreview').classList.remove('hidden');
      $('smartConfirm').classList.remove('hidden');
    } catch (error) {
      $('smartError').textContent = error.message;
    } finally {
      $('smartParse').disabled = false;
      $('smartParse').textContent = 'Ask AI';
    }
  };

  $('smartConfirm').onclick = async () => {
    if (!smartActions.length) return;
    $('smartConfirm').disabled = true;
    busy(true);
    try {
      for (const action of smartActions) {
        let response;
        if (action.type === 'add') response = await sb.from('lessons').insert(action.payload);
        if (action.type === 'update') response = await sb.from('lessons').update(action.patch).eq('id', action.id);
        if (action.type === 'delete') response = await sb.from('lessons').delete().eq('id', action.id);
        if (response?.error) throw response.error;
      }
      const count = smartActions.length;
      const type = smartActions[0].type;
      $('smartDialog').close();
      toast(`${count} lesson${count === 1 ? '' : 's'} ${type === 'delete' ? 'deleted' : type === 'update' ? 'updated' : 'added'}.`);
      await loadLessons();
    } catch (error) {
      $('smartError').textContent = error.message || 'The calendar update failed.';
    } finally {
      busy(false);
      $('smartConfirm').disabled = false;
    }
  };
})();