
// This function is now the CLIENT-SIDE fetcher that calls the API route.
export async function getAIMatchScore(resumeText: string) {
  try {
    const response = await fetch("/api/ai/match-score", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ resumeText }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to fetch AI match score.");
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error("Error fetching AI match score:", error);
    // Return null or a default error structure to be handled by the UI
    return null;
  }
}
