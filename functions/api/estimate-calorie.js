// Cloudflare Pages Function: /api/estimate-calorie
// Cloudflare Workers AI (Llama 3) を呼び出して食品名からカロリーを推定する
//
// セットアップ (Cloudflareダッシュボードで一度だけ):
//   1. Pages プロジェクト → Settings → Bindings → Add binding
//   2. Type: Workers AI / Variable name: AI
//   3. Save、再デプロイ

const SYSTEM_PROMPT = `あなたは食品のカロリーを推定する栄養アシスタントです。
日本食を含む様々な食品の標準的な1人前のカロリー(kcal)を、整数で推定してください。
回答は必ず以下のJSON形式のみで、他の文章は一切含めないでください。

{"kcal": 整数, "confidence": 0から1の小数, "note": "標準的な分量の説明 (20文字以内)"}

confidence の目安:
- 0.8〜1.0: 一般的でカロリーがほぼ確定的な食品 (例: ご飯一杯)
- 0.5〜0.7: 一般的だが調理法で変動する食品 (例: 唐揚げ)
- 0.2〜0.4: 具体性が低い、または特殊な食品 (例: 「弁当」だけ)`;

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // バインディングが無い場合のフェイルセーフ
  if (!env.AI) {
    return jsonResponse({ error: 'Workers AI binding not configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const foodName = (body.foodName || '').toString().trim();
  if (!foodName) return jsonResponse({ error: 'foodName required' }, 400);
  if (foodName.length > 100) return jsonResponse({ error: 'foodName too long' }, 400);

  try {
    const aiResult = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `食品名: ${foodName}\n標準的な1人前のカロリーをJSON形式のみで回答してください。` },
      ],
      max_tokens: 120,
      temperature: 0.2,
    });

    const text = (aiResult && aiResult.response) || '';
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) {
      return jsonResponse({ error: 'AIの回答を解析できませんでした', raw: text }, 502);
    }

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return jsonResponse({ error: 'JSON解析失敗', raw: match[0] }, 502);
    }

    const kcal = Math.round(Number(parsed.kcal));
    if (!isFinite(kcal) || kcal <= 0 || kcal > 5000) {
      return jsonResponse({ error: '不正なkcal値', raw: parsed }, 502);
    }
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
    const note = (parsed.note || '').toString().slice(0, 60);

    return jsonResponse({ kcal, confidence, note });
  } catch (e) {
    return jsonResponse({ error: 'AI呼び出しエラー: ' + (e.message || 'unknown') }, 500);
  }
}

// CORS / プリフライト 等は同一オリジンなので不要
export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return new Response('Method not allowed', { status: 405 });
}
