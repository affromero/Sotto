## Output Format:

Return a JSON object:
{
"claims": [
{
"claimText": "the specific claim",
"turnIndex": 0,
"speaker": "HOST" | "EXPERT",
"isCommonKnowledge": false,
"existingCitations": [1, 3],
"needsMoreCitations": true,
"hasUnreliableSource": false,
"unreliableCitations": [],
"hasMisattribution": false,
"verificationNote": "brief explanation"
}
],
"overallScore": 0.85,
"feedback": "Concise revision instructions if score < threshold. Be specific about which claims need better sourcing and what kind of sources would be acceptable."
}

Return ONLY the JSON object.
