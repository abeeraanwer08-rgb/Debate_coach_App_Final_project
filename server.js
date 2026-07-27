// server.js
// Express backend for Podium — the AI Debate Coach. Serves the static frontend
// and powers speech generation, POIs, cross-ex, judging, and critique via Groq.

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const fs = require('fs');
const path = require('path');

function loadDataFile(filename) {
  const paths = [
    path.join(__dirname, 'data', filename),
    path.join(__dirname, 'podium-debate-coach', 'data', filename),
    path.join(__dirname, 'debate-coach', 'data', filename),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      return require(p);
    }
  }
  throw new Error(`Cannot find ${filename} in any expected location.`);
}

const formats = loadDataFile('formats.json');
const motions = loadDataFile('motions.json');
const fallacies = loadDataFile('fallacies.json');
const guide = loadDataFile('guide.json');
const { callGroq, callGroqJSON, callGroqVision } = require('./utils/groq');
const {
  buildSpeechPrompt,
  buildPoiQuestionPrompt,
  buildPoiResponsePrompt,
  buildCrossExPrompt,
  buildSuggestionPrompt,
  buildJudgePrompt,
  buildCritiquePrompt,
  buildFrameAnalysisPrompt,
  buildGuideAskPrompt,
} = require('./utils/prompts');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '8mb' })); // generous limit to allow a few base64 video frames
app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));

// In-memory store for shareable results (resets on server restart / new deploy).
const shareStore = new Map();

// ---------- Reference data ----------

app.get('/api/formats', (req, res) => res.json(formats));

app.get('/api/motions/random', (req, res) => {
  const { style } = req.query;
  const pick = motions[Math.floor(Math.random() * motions.length)];
  res.json({ motion: pick, style: style || null });
});

app.get('/api/fallacies', (req, res) => res.json(fallacies));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.GROQ_API_KEY) });
});

// ---------- Speech generation ----------

app.post('/api/speech', async (req, res) => {
  try {
    const { style, motion, role, roleName, teamName, side, persona, speechType, durationSeconds, transcript, difficulty } = req.body;
    if (!style || !motion || !role || !roleName) {
      return res.status(400).json({ error: 'style, motion, role, and roleName are required.' });
    }
    const messages = buildSpeechPrompt({
      style, motion, role, roleName, teamName, side,
      persona: persona || 'standard',
      speechType: speechType || 'main',
      durationSeconds: durationSeconds || 300,
      transcript: transcript || [],
      difficulty: difficulty || 'intermediate',
    });
    const text = await callGroq(messages, { temperature: 0.85, maxTokens: 700 });
    res.json({ text: text.trim() });
  } catch (err) {
    console.error('[speech]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Points of Information ----------

app.post('/api/poi-question', async (req, res) => {
  try {
    const { motion, askingRoleName, askingTeamName, targetRoleName, currentSpeechText } = req.body;
    const messages = buildPoiQuestionPrompt({ motion, askingRoleName, askingTeamName, targetRoleName, currentSpeechText: currentSpeechText || '' });
    const text = await callGroq(messages, { temperature: 0.9, maxTokens: 80 });
    res.json({ question: text.trim().replace(/^"|"$/g, '') });
  } catch (err) {
    console.error('[poi-question]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/poi-response', async (req, res) => {
  try {
    const { motion, speakerRoleName, question } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required.' });
    const messages = buildPoiResponsePrompt({ motion, speakerRoleName, question });
    const result = await callGroqJSON(messages, { temperature: 0.6, maxTokens: 150 });
    res.json(result);
  } catch (err) {
    console.error('[poi-response]', err.message);
    res.status(500).json({ error: err.message, accepted: false, response: '' });
  }
});

// ---------- Cross-examination (Lincoln-Douglas) ----------

app.post('/api/cross-ex-question', async (req, res) => {
  try {
    const { motion, questionerRole, answererRole, opponentSpeechText } = req.body;
    const messages = [
      { role: 'system', content: 'You are a Lincoln-Douglas debater cross-examining your opponent. Ask ONE sharp, concise question (under 25 words) that probes a weakness in their case. Respond with ONLY the question.' },
      { role: 'user', content: `MOTION: ${motion}\nYou are ${questionerRole}, questioning ${answererRole}, who argued:\n"${(opponentSpeechText || '').slice(-700)}"\n\nAsk your question.` },
    ];
    const text = await callGroq(messages, { temperature: 0.85, maxTokens: 70 });
    res.json({ question: text.trim().replace(/^"|"$/g, '') });
  } catch (err) {
    console.error('[cross-ex-question]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cross-ex-answer', async (req, res) => {
  try {
    const { motion, questionerRole, answererRole, question } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required.' });
    const messages = buildCrossExPrompt({ motion, questionerRole, answererRole, question });
    const text = await callGroq(messages, { temperature: 0.7, maxTokens: 120 });
    res.json({ answer: text.trim() });
  } catch (err) {
    console.error('[cross-ex-answer]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Practice mode: tactical suggestions ----------

app.post('/api/suggest', async (req, res) => {
  try {
    const { motion, roleName, teamName, side, transcript } = req.body;
    const messages = buildSuggestionPrompt({ motion, roleName, teamName, side, transcript: transcript || [] });
    const result = await callGroqJSON(messages, { temperature: 0.7, maxTokens: 250 });
    res.json(result);
  } catch (err) {
    console.error('[suggest]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Format Guide AI chatbot ----------

function guideContextText() {
  return Object.values(guide).map((fmt) => {
    const lines = [`### ${fmt.name}`, fmt.summary];
    (fmt.benches || []).forEach((bench) => {
      lines.push(`Team: ${bench.team}`);
      bench.speakers.forEach((sp) => lines.push(`  ${sp.role} — ${sp.duties.join(' ')}`));
    });
    (fmt.sides || []).forEach((side) => {
      lines.push(`${side.role} — ${side.duties.join(' ')} Responsibilities: ${side.responsibilities.join(' ')}`);
    });
    if (fmt.speakingOrderTable) {
      lines.push('Speaking order: ' + fmt.speakingOrderTable.map(([a, b, c]) => `${a} (${b}, ${c})`).join(', '));
    } else if (fmt.speakingOrder) {
      lines.push('Speaking order: ' + fmt.speakingOrder.map(([a, b]) => `${a} (${b})`).join(', '));
    }
    lines.push(`${fmt.qanda.title} — ${fmt.qanda.explanation} Rules: ${fmt.qanda.rules.join(' ')}`);
    lines.push('Key concepts: ' + fmt.keyConcepts.join(' '));
    return lines.join('\n');
  }).join('\n\n');
}

app.post('/api/guide/ask', async (req, res) => {
  try {
    const { question, format, history } = req.body;
    if (!question || !question.trim()) return res.status(400).json({ error: 'question is required.' });
    const messages = buildGuideAskPrompt({ question: question.trim(), format, guideContext: guideContextText(), history });
    const answer = await callGroq(messages, { temperature: 0.5, maxTokens: 300 });
    res.json({ answer: answer.trim() });
  } catch (err) {
    console.error('[guide-ask]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Live fallacy analysis (AI pass on top of local pattern matching) ----------

app.post('/api/analyze-fallacies', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 12) return res.json({ fallacies: [] });
    const validIds = new Set(fallacies.map((f) => f.id));
    const messages = [
      {
        role: 'system',
        content: `You detect logical fallacies in debate speech text. Valid fallacy ids: ${[...validIds].join(', ')}. Respond with ONLY strict JSON: {"fallacies":[{"id": string, "quote": string, "explanation": string}]}. Only flag genuine, clear instances; return an empty array if none are present.`,
      },
      { role: 'user', content: text.slice(0, 1500) },
    ];
    const result = await callGroqJSON(messages, { temperature: 0.3, maxTokens: 400 });
    result.fallacies = (result.fallacies || []).filter((f) => validIds.has(f.id));
    res.json(result);
  } catch (err) {
    console.error('[analyze-fallacies]', err.message);
    res.json({ fallacies: [] });
  }
});

// ---------- Video frame body-language analysis ----------

app.post('/api/analyze-frames', async (req, res) => {
  try {
    const { images } = req.body;
    if (!Array.isArray(images) || !images.length) {
      return res.status(400).json({ error: 'images (array of data URLs) is required.' });
    }
    const prompt = buildFrameAnalysisPrompt();
    const notes = await callGroqVision(prompt, images);
    res.json({ notes: notes.trim() });
  } catch (err) {
    console.error('[analyze-frames]', err.message);
    // Graceful fallback so a missing/rotated vision model never breaks the round.
    res.json({ notes: 'Video was recorded, but automated body-language analysis was unavailable this round. Review the replay yourself for posture, eye contact, and gesture cues.', fallback: true });
  }
});

// ---------- Judging ----------

app.post('/api/judge', async (req, res) => {
  try {
    const { style, motion, speakers, transcript } = req.body;
    if (!style || !motion || !Array.isArray(speakers) || !Array.isArray(transcript)) {
      return res.status(400).json({ error: 'style, motion, speakers, and transcript are required.' });
    }
    const messages = buildJudgePrompt({ style, motion, speakers, transcript });
    const result = await callGroqJSON(messages, { temperature: 0.4, maxTokens: 1600 });

    // Guardrails: clamp scores 0-100, ensure every speaker has an entry.
    const byId = new Map((result.speakerScores || []).map((s) => [s.id, s]));
    result.speakerScores = speakers.map((sp) => {
      const s = byId.get(sp.id) || { content: 24, strategy: 18, style: 12, rebuttal: 6 };
      const content = Math.max(0, Math.min(40, Math.round(s.content ?? 24)));
      const strategy = Math.max(0, Math.min(30, Math.round(s.strategy ?? 18)));
      const style = Math.max(0, Math.min(20, Math.round(s.style ?? 12)));
      const rebuttal = Math.max(0, Math.min(10, Math.round(s.rebuttal ?? 6)));
      return {
        id: sp.id,
        content, strategy, style, rebuttal,
        total: content + strategy + style + rebuttal,
        oneLineVerdict: s.oneLineVerdict || '',
      };
    });
    if (!result.bestSpeakerId || !byId.has(result.bestSpeakerId)) {
      result.speakerScores.sort((a, b) => b.total - a.total);
      result.bestSpeakerId = result.speakerScores[0]?.id;
    }

    // Team ranking is computed here, deterministically, from the clamped speaker
    // totals — never trusted from the model's own arithmetic. This matters most
    // for British Parliamentary, which has 4 independent benches (Opening Gov,
    // Opening Opp, Closing Gov, Closing Opp) that must be ranked 1st-4th; it is
    // NOT a two-side Gov-vs-Opp format like Asian Parliamentary or Lincoln-Douglas.
    const scoreById = new Map(result.speakerScores.map((s) => [s.id, s.total]));
    const teamTotals = new Map();
    const teamMeta = new Map();
    speakers.forEach((sp) => {
      const key = sp.team || sp.teamName;
      if (!key) return;
      teamTotals.set(key, (teamTotals.get(key) || 0) + (scoreById.get(sp.id) || 0));
      teamMeta.set(key, sp.teamName || key);
    });
    const teamRanking = [...teamTotals.entries()]
      .map(([team, total]) => ({ team, teamName: teamMeta.get(team), total }))
      .sort((a, b) => b.total - a.total)
      .map((t, i) => ({ ...t, rank: i + 1 }));

    result.teamRanking = teamRanking;
    if (teamRanking.length) {
      result.winningTeam = teamRanking[0].team;
      result.winningTeamName = teamRanking[0].teamName;
    }

    res.json(result);
  } catch (err) {
    console.error('[judge]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Critique session ----------

app.post('/api/critique', async (req, res) => {
  try {
    const { style, motion, speakers, transcript, scores, videoNotes } = req.body;
    if (!scores) return res.status(400).json({ error: 'scores is required (run /api/judge first).' });
    const messages = buildCritiquePrompt({ style, motion, speakers, transcript, scores, videoNotes: videoNotes || {} });
    const result = await callGroqJSON(messages, { temperature: 0.6, maxTokens: 1800 });
    res.json(result);
  } catch (err) {
    console.error('[critique]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Share a finished round ----------

app.post('/api/share', (req, res) => {
  const id = crypto.randomBytes(5).toString('hex');
  shareStore.set(id, { ...req.body, createdAt: Date.now() });
  res.json({ id });
});

app.get('/api/share/:id', (req, res) => {
  const item = shareStore.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found. Shared rounds only live as long as the server stays running.' });
  res.json(item);
});

// Fallback to index.html for any non-API route (single-page app).
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Podium is running at http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY) {
    console.warn('WARNING: GROQ_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
});

module.exports = app;
