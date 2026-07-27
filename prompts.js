// utils/prompts.js
// Builds the message arrays sent to Groq for every AI touchpoint in a debate round.

function condenseTranscript(transcript, maxEntries = 12) {
  const slice = transcript.slice(-maxEntries);
  return slice
    .map((t) => {
      const poi = (t.pois || [])
        .map((p) => `    POI from ${p.from}: "${p.question}" -> ${p.accepted ? `answered: "${p.response}"` : 'declined'}`)
        .join('\n');
      return `[${t.role}] ${t.speakerName} (${t.teamName}):\n${t.text}${poi ? '\n' + poi : ''}`;
    })
    .join('\n\n');
}

function styleLabel(style) {
  return { bp: 'British Parliamentary', asian: 'Asian Parliamentary', ld: 'Lincoln-Douglas' }[style] || style;
}

function personaFlavor(persona) {
  const map = {
    standard: 'a sharp, well-rounded competitive debater',
    scientist: 'a debater who leans on empirical evidence, data, and cautious, precise claims',
    lawyer: 'a debater who argues like a litigator: precise definitions, precedent, and airtight logical structure',
    politician: 'a debater who is persuasive, values-driven, and skilled at rhetorical framing and soundbites',
    philosopher: 'a debater who probes underlying principles, ethical frameworks, and first-principles reasoning',
    journalist: 'a debater who argues with concrete real-world examples, case studies, and clear plain language',
  };
  return map[persona] || map.standard;
}

function buildSpeechPrompt({ style, motion, role, roleName, teamName, side, persona, speechType, durationSeconds, transcript, difficulty }) {
  const minutes = Math.round(durationSeconds / 60 * 10) / 10;
  const context = transcript.length ? condenseTranscript(transcript) : '(You are opening the debate — no prior speeches yet.)';
  const system = `You are an elite competitive debater performing in a ${styleLabel(style)} round. You are ${personaFlavor(persona)}. You speak in the first person, as if delivered live at a podium. Never break character, never mention that you are an AI. Keep the speech tightly argued, persuasive, and appropriate for a ${minutes}-minute speech (roughly ${Math.max(80, Math.round(minutes * 130))}-${Math.round(minutes * 160)} words). Use clear signposting (headline claims, brief structure cues) but do NOT use markdown headers or bullet lists — write it as spoken prose with natural paragraph breaks. Difficulty level for this round: ${difficulty || 'intermediate'}.`;

  const user = `MOTION: ${motion}
YOUR ROLE: ${roleName} (${role}) for ${teamName}, arguing the ${side === 'gov' || side === 'aff' ? 'proposition/affirmative' : 'opposition/negative'} side.
SPEECH TYPE: ${speechType}

DEBATE SO FAR:
${context}

Deliver your speech now. ${speechType === 'reply' ? 'This is a reply speech: summarize the debate persuasively from your bench\'s perspective and explain why your side should win. Do not introduce brand-new arguments.' : ''} ${speechType === 'rebuttal' ? 'This is a rebuttal: directly answer the strongest points made against your side, then extend your own case.' : ''} Respond with ONLY the spoken text of the speech, no labels or preamble.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildPoiQuestionPrompt({ motion, askingRoleName, askingTeamName, targetRoleName, currentSpeechText }) {
  const system = `You are a sharp competitive debater raising a 15-second Point of Information during an opponent's speech. Ask ONE short, pointed question or make a brief challenging interjection (under 25 words) designed to trip up their argument. Respond with ONLY the question text.`;
  const user = `MOTION: ${motion}\nYou are ${askingRoleName} of ${askingTeamName}. The current speaker (${targetRoleName}) has said so far:\n"${currentSpeechText.slice(-600)}"\n\nRaise your point of information now.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildPoiResponsePrompt({ motion, speakerRoleName, question }) {
  const system = `You are a competitive debater mid-speech, deciding whether to accept a Point of Information. Respond with ONLY strict JSON: {"accepted": boolean, "response": string}. Accept roughly 1 in 2 POIs offered (vary it), and when declining leave response as an empty string. When accepted, the response should be a sharp, brief (under 40 words) rebuttal to the POI that folds back into your speech.`;
  const user = `MOTION: ${motion}\nYou are the ${speakerRoleName} currently speaking. A Point of Information has been offered: "${question}"\n\nDecide and respond in JSON.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildCrossExPrompt({ motion, questionerRole, answererRole, question }) {
  const system = `You are a Lincoln-Douglas debater being cross-examined. Answer directly, concisely (under 45 words), defending your case without conceding ground unnecessarily. Respond with ONLY the answer text.`;
  const user = `MOTION: ${motion}\nYou are ${answererRole}. ${questionerRole} asks: "${question}"\n\nAnswer now.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildSuggestionPrompt({ motion, roleName, teamName, side, transcript }) {
  const context = transcript.length ? condenseTranscript(transcript, 6) : '(Debate has not started yet.)';
  const system = `You are a debate coach giving a student quick, tactical suggestions before they speak. Respond with ONLY strict JSON: {"suggestions": [string, string, string]} — three short, concrete argument or rebuttal ideas (each under 20 words), tailored to their role and what's already been said.`;
  const user = `MOTION: ${motion}\nSTUDENT ROLE: ${roleName} for ${teamName} (${side} side)\n\nDEBATE SO FAR:\n${context}\n\nGive three tactical suggestions in JSON.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildJudgePrompt({ style, motion, speakers, transcript }) {
  const roster = speakers.map((s) => `- id:"${s.id}" | ${s.role} (${s.roleName}) | ${s.teamName} | ${s.isHuman ? 'human' : 'AI'} speaker named ${s.name}`).join('\n');
  const fullTranscript = transcript
    .map((t) => {
      const poi = (t.pois || []).map((p) => `  POI: "${p.question}" -> ${p.accepted ? `"${p.response}"` : 'declined'}`).join('\n');
      return `--- ${t.role} (${t.teamName}) — ${t.speakerName} ---\n${t.text}\n${poi}`;
    })
    .join('\n\n');

  const formatNote = style === 'bp'
    ? 'IMPORTANT: British Parliamentary has FOUR INDEPENDENT teams (Opening Government, Opening Opposition, Closing Government, Closing Opposition) competing for 1st, 2nd, 3rd, and 4th place — it is NOT a two-side Government-vs-Opposition contest. A Government-bench team can easily place below an Opposition-bench team. Judge each bench on its own merits (did it extend the case, engage with the room, bring new material) and be prepared to rank a Closing team above an Opening team on the same side, or vice versa.'
    : style === 'asian'
    ? 'This is Asian Parliamentary: a two-team contest (Government vs Opposition). Declare one winning team.'
    : 'This is Lincoln-Douglas: a 1v1 contest (Affirmative vs Negative). Declare one winning side.';

  const system = `You are a rigorous, fair competitive debate adjudicator judging a ${styleLabel(style)} round. ${formatNote} Score every speaker out of 100 using this exact weighting: Content 40% (argument quality, evidence, relevance to the motion), Strategy 30% (structure, prioritization, engagement with the round), Style 20% (delivery, clarity, persuasiveness of the writing/register), Rebuttal 10% (how well they answered opposing points). Each of the four sub-scores should be given out of its own weighted maximum (e.g. content out of 40, strategy out of 30, style out of 20, rebuttal out of 10) so they sum to the total out of 100. Be discriminating — do not give everyone the same score; reward genuinely stronger speeches and penalize weak or repetitive ones. Determine the single Best Speaker of the round (highest total score). Respond with ONLY strict JSON matching this shape:
{
  "speakerScores": [ { "id": string, "content": number, "strategy": number, "style": number, "rebuttal": number, "total": number, "oneLineVerdict": string } ],
  "winningTeamReason": string (explain why the top-placing team/side won — for BP, reference bench-level performance, not just "Government" or "Opposition"),
  "bestSpeakerId": string,
  "bestSpeakerReason": string
}`;

  const user = `MOTION: ${motion}\n\nSPEAKERS:\n${roster}\n\nFULL TRANSCRIPT:\n${fullTranscript}\n\nJudge the round now. Output JSON only.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildCritiquePrompt({ style, motion, speakers, transcript, scores, videoNotes }) {
  const roster = speakers.map((s) => `- id:"${s.id}" | ${s.role} | ${s.teamName} | ${s.name}`).join('\n');
  const scoreSummary = (scores.speakerScores || [])
    .map((s) => `${s.id}: total ${s.total}/100 (content ${s.content}, strategy ${s.strategy}, style ${s.style}, rebuttal ${s.rebuttal})`)
    .join('\n');
  const fullTranscript = transcript.map((t) => `--- ${t.role} (${t.teamName}) — ${t.speakerName} ---\n${t.text}`).join('\n\n');
  const videoBlock = videoNotes && Object.keys(videoNotes).length
    ? `VIDEO/BODY-LANGUAGE NOTES (from recorded footage):\n${Object.entries(videoNotes).map(([id, n]) => `${id}: ${n}`).join('\n')}`
    : 'No video was recorded for this round.';
  const rankingBlock = (scores.teamRanking && scores.teamRanking.length)
    ? `TEAM RANKING (1st to last):\n${scores.teamRanking.map((t) => `${t.rank}. ${t.teamName} — ${t.total} pts`).join('\n')}`
    : `Winning team: ${scores.winningTeam}`;

  const system = `You are a warm but exacting debate coach delivering a post-round critique session (framed as a 7-minute debrief). You already know the scores. ${style === 'bp' ? 'Remember this is British Parliamentary: discuss the FULL 1st-4th bench ranking, not just a Government-vs-Opposition split.' : ''} Respond with ONLY strict JSON matching this shape:
{
  "overallAnalysis": string (3-5 sentences on what worked and what didn't across the room),
  "perSpeaker": [ { "id": string, "strengths": string, "delivery": string, "rebuttalWork": string, "improvement": string } ],
  "keyMoments": [ { "label": string, "detail": string } ] (3-5 entries covering best argument, best rebuttal, a turning point, and a missed opportunity — label each clearly),
  "tips": [ string ] (4-6 specific, actionable tips),
  "videoAnalysis": [ { "id": string, "notes": string } ] (only include entries for speakers with video notes provided; if none, return an empty array),
  "bestSpeakerRecap": string (one warm sentence naming the best speaker and their winning score out of 100, celebrating specifically what they did well)
}`;

  const user = `MOTION: ${motion}\nFORMAT: ${styleLabel(style)}\n\nSPEAKERS:\n${roster}\n\nSCORES:\n${scoreSummary}\nBest speaker id: ${scores.bestSpeakerId}\n${rankingBlock}\n\n${videoBlock}\n\nFULL TRANSCRIPT:\n${fullTranscript}\n\nWrite the critique now. Output JSON only.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildFrameAnalysisPrompt() {
  return `You are a debate coach reviewing still frames captured from a student's speech video. In under 70 words, comment on posture, eye contact, gestures, and apparent confidence level. Be specific and constructive, not generic. Respond with plain text only, no JSON, no markdown.`;
}

function buildGuideAskPrompt({ question, format, guideContext, history }) {
  const system = `You are a friendly, knowledgeable debate coach assistant embedded in Podium's "Format Guide" screen. You answer questions about competitive debate formats, speaker roles, timing, POIs, and cross-examination — strictly grounded in the reference material below, which covers British Parliamentary, Asian Parliamentary, and Lincoln-Douglas.

The user is currently viewing the ${styleLabel(format || 'bp')} guide, so prioritize that format unless they explicitly ask to compare formats or ask about a different one by name.

Keep answers short and conversational: 2-4 sentences, plain prose, no markdown headers or bullet lists (a couple of inline commas/semicolons are fine). If the question is unrelated to debate formats, rules, or roles, politely redirect: "I can help with debate format questions — try asking about roles, timing, or POIs!" Never make up rules that aren't in the reference material below; if you're not sure, say the exact rule can vary by tournament.

REFERENCE MATERIAL (all 3 formats):
${guideContext}`;

  const turns = (history || []).slice(-6).map((h) => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: h.text }));

  return [
    { role: 'system', content: system },
    ...turns,
    { role: 'user', content: question },
  ];
}

module.exports = {
  buildSpeechPrompt,
  buildPoiQuestionPrompt,
  buildPoiResponsePrompt,
  buildCrossExPrompt,
  buildSuggestionPrompt,
  buildJudgePrompt,
  buildCritiquePrompt,
  buildFrameAnalysisPrompt,
  buildGuideAskPrompt,
};
