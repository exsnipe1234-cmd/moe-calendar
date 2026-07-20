const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const schema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'action', 'query_mode', 'teacher', 'date', 'date_from', 'date_to', 'start_time', 'end_time',
    'school', 'class_name', 'activity', 'status', 'replacement_teacher', 'requested_changes',
    'clarification_question', 'confirmation_message', 'answer'
  ],
  properties: {
    action: { type: 'string', enum: ['add', 'update', 'delete', 'query', 'clarification'] },
    query_mode: { type: 'string', enum: ['lessons', 'free_teachers', 'teacher_load', 'conflicts'] },
    teacher: nullableString,
    date: nullableString,
    date_from: nullableString,
    date_to: nullableString,
    start_time: nullableString,
    end_time: nullableString,
    school: nullableString,
    class_name: nullableString,
    activity: nullableString,
    status: nullableString,
    replacement_teacher: nullableString,
    requested_changes: {
      type: 'object',
      additionalProperties: false,
      required: ['teacher', 'date', 'start_time', 'end_time', 'school', 'class_name', 'activity', 'status'],
      properties: {
        teacher: nullableString,
        date: nullableString,
        start_time: nullableString,
        end_time: nullableString,
        school: nullableString,
        class_name: nullableString,
        activity: nullableString,
        status: nullableString,
      },
    },
    clarification_question: { type: 'string' },
    confirmation_message: { type: 'string' },
    answer: { type: 'string' },
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');

    const body = await req.json();
    const message = String(body.message || '').trim();
    if (!message) throw new Error('Message is required.');

    const context = {
      today: body.today,
      timezone: body.timezone || 'Asia/Singapore',
      teachers: Array.isArray(body.teachers) ? body.teachers : [],
      lessons: Array.isArray(body.lessons) ? body.lessons : [],
      conversation: Array.isArray(body.conversation) ? body.conversation : [],
    };

    const instructions = `You are Music Delight AI, a calendar intent parser for a Singapore music school.
Return only the structured result required by the schema.
Today is ${context.today} in ${context.timezone}.
Resolve relative dates such as tomorrow, next Friday, this month and August into ISO YYYY-MM-DD dates. For a whole month, use date_from and date_to.
Teacher names must match one of the supplied teacher names when possible.
Actions:
- add: create one lesson. Require teacher, date, start_time, end_time, school and activity; ask clarification when essential information is missing.
- update: find existing lessons using top-level filter fields, then put only new values in requested_changes. Teacher replacement can also use replacement_teacher.
- delete: find existing lessons using top-level filter fields.
- query: search without changing data. Use query_mode lessons, free_teachers, teacher_load or conflicts.
- clarification: use only when the request cannot be safely interpreted.
Use 24-hour HH:MM times. Do not invent an existing lesson. The website will perform the final database match and confirmation.
Set unused nullable fields to null, and unused text messages to an empty string.`;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        instructions,
        input: JSON.stringify({ user_message: message, context }),
        text: {
          format: {
            type: 'json_schema',
            name: 'calendar_intent',
            strict: true,
            schema,
          },
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'OpenAI request failed.');

    const outputText = data.output_text || data.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text;
    if (!outputText) throw new Error('OpenAI returned no structured output.');
    const result = JSON.parse(outputText);

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
