
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: Request) {
  try {
    const { resumeText } = await req.json();

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set in the environment variables.");
    }
    
    if (!resumeText) {
      return new Response(JSON.stringify({ error: "Resume text is required." }), { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

    const prompt = `
    Analyze this candidate resume and return ONLY a valid JSON object with two keys: "score" (a number from 0 to 100) and "summary" (a brief, one-sentence summary of the candidate's fit).

    Resume:
    ${resumeText}

    Example of the exact output format required:
    {
      "score": 85,
      "summary": "The candidate has strong experience in backend development and cloud services."
    }
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Clean the response to ensure it is valid JSON
    const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

    // Validate that the cleaned text is a valid JSON before returning
    JSON.parse(cleanedText);

    return new Response(cleanedText, { 
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (error: any) {
    console.error("AI Match Score API Error:", error);
    return new Response(JSON.stringify({ error: `AI analysis failed: ${error.message}` }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}
