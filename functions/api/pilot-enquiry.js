const recipient = 'hello@oliverhitchings.com';

function clean(value, max = 1200) {
	return String(value ?? '')
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);
}

function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
		},
	});
}

function buildEmail(data) {
	const lines = [
		'Hi Oliver,',
		'',
		'I would like to book a workflow call for the £2k AI Automation Pilot.',
		'',
		`Name: ${data.name}`,
		`Company: ${data.company}`,
		`Email: ${data.email}`,
		`Team size: ${data.teamSize}`,
		'',
		`Repeated task wasting time: ${data.pain}`,
		`Current tools: ${data.tools || 'Not specified'}`,
		`What fixing it would save: ${data.value || 'Not specified'}`,
		'',
		'Thanks,',
		data.name,
	].join('\n');

	return `mailto:${recipient}?subject=${encodeURIComponent('AI Automation Pilot workflow call')}&body=${encodeURIComponent(lines)}`;
}

export async function onRequestPost({ request, env }) {
	let raw;
	try {
		raw = await request.json();
	} catch {
		return json({ ok: false, error: 'Invalid form submission.' }, 400);
	}

	if (clean(raw.website, 200)) {
		return json({ ok: true, fallback: true });
	}

	const data = {
		name: clean(raw.name, 120),
		company: clean(raw.company, 160),
		email: clean(raw.email, 180),
		teamSize: clean(raw.teamSize, 60),
		pain: clean(raw.pain, 1200),
		tools: clean(raw.tools, 500),
		value: clean(raw.value, 500),
	};

	const missing = ['name', 'company', 'email', 'teamSize', 'pain'].filter((field) => !data[field]);
	if (missing.length) {
		return json({ ok: false, error: `Missing: ${missing.join(', ')}` }, 400);
	}

	if (!/^\S+@\S+\.\S+$/.test(data.email)) {
		return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
	}

	const mailto = buildEmail(data);

	if (env.PILOT_LEAD_WEBHOOK_URL) {
		try {
			const response = await fetch(env.PILOT_LEAD_WEBHOOK_URL, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					source: 'oliverhitchings.com/pilot',
					receivedAt: new Date().toISOString(),
					...data,
				}),
			});
			if (response.ok) {
				return json({ ok: true, delivered: true });
			}
		} catch {
			// Fall back to client-reviewed email draft below.
		}
	}

	return json({ ok: false, fallback: 'mailto', mailto });
}

export async function onRequestGet() {
	return json({ ok: true, endpoint: 'pilot-enquiry', methods: ['POST'] });
}
