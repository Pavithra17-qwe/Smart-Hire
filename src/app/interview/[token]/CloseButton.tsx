'use client';
// app/interview/[token]/CloseButton.tsx
//
// Small client-only button used solely by ExpiredPage's "Interview Link
// No Longer Valid" state (page.tsx stays a server component otherwise).

export default function CloseButton() {
  const handleClick = () => {
    // window.close() only works on script-opened windows in most browsers.
    // Fall back to sending the candidate to a blank/neutral state instead
    // of doing nothing if it's blocked.
    window.close();
    setTimeout(() => {
      window.location.href = 'about:blank';
    }, 100);
  };

  return (
    <button
      onClick={handleClick}
      style={{
        display: 'inline-block',
        background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
        color: 'white',
        border: 'none',
        borderRadius: '12px',
        padding: '12px 32px',
        fontSize: '14px',
        fontWeight: 700,
        cursor: 'pointer',
        marginBottom: '24px',
        boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
      }}
    >
      Close
    </button>
  );
}