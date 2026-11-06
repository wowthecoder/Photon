const icon = (d: string) => () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

export const NewChatIcon = icon("M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z");
export const SidebarIcon = icon("M3 5h18v14H3zM9 5v14");
export const SettingsIcon = icon("M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4");
export const TrashIcon = icon("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3");
export const SendIcon = icon("M12 19V5M5 12l7-7 7 7");
export const StopIcon = icon("M7 7h10v10H7z");
export const ModelsIcon = icon("M12 3 4 7.5v9L12 21l8-4.5v-9ZM4 7.5l8 4.5 8-4.5M12 12v9");
