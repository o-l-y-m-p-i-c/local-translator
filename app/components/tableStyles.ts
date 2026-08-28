/**
 * Shared table styles for the redesign.
 * Import TABLE_STYLES and use on <table style={TABLE_STYLES.table}>.
 */

export const TABLE_STYLES = {
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "14px",
  },
  thead: {
    background: "#f6f6f7",
  },
  th: {
    textAlign: "left" as const,
    padding: "10px 12px",
    borderBottom: "2px solid #ebebeb",
    fontWeight: 600,
    fontSize: "12px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    color: "#616161",
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #ebebeb",
    verticalAlign: "top" as const,
  },
  trHover: {
    cursor: "pointer",
  },
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "12px",
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
  },
  badgeSuccess: {
    background: "#e0f5e0",
    color: "#107c10",
  },
  badgeWarning: {
    background: "#fff4e0",
    color: "#b25e00",
  },
  badgeCritical: {
    background: "#ffe0e0",
    color: "#c50f0f",
  },
  badgeInfo: {
    background: "#e0f0ff",
    color: "#0066cc",
  },
  badgeNeutral: {
    background: "#f0f0f0",
    color: "#616161",
  },
  input: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid #ddd",
    fontSize: "14px",
  },
  textarea: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid #ddd",
    fontSize: "14px",
    resize: "vertical" as const,
    fontFamily: "inherit",
  },
  select: {
    display: "block" as const,
    width: "100%",
    padding: "10px",
    borderRadius: "8px",
    border: "1px solid #ddd",
    fontSize: "14px",
    background: "#fff",
  },
  cardRow: {
    background: "#fff",
    borderRadius: "12px",
    border: "1px solid #ebebeb",
    padding: "16px",
    marginBottom: "8px",
  },
  progressBar: {
    width: "100%",
    height: "8px",
    background: "#ebebeb",
    borderRadius: "4px",
    overflow: "hidden",
  },
  progressFill: (percent: number) => ({
    width: `${Math.min(percent, 100)}%`,
    height: "100%",
    background: percent >= 100 ? "#107c10" : "#0066cc",
    transition: "width 0.3s ease",
  }),
  statCard: {
    flex: 1,
    background: "#fff",
    borderRadius: "12px",
    border: "1px solid #ebebeb",
    padding: "16px",
    textAlign: "center" as const,
  },
  statNumber: {
    fontSize: "28px",
    fontWeight: 700,
    margin: 0,
  },
  statLabel: {
    fontSize: "12px",
    color: "#616161",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    margin: "4px 0 0",
  },
  toolbar: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap" as const,
  },
  searchInput: {
    flex: 1,
    minWidth: "200px",
    padding: "10px 14px",
    borderRadius: "8px",
    border: "1px solid #ddd",
    fontSize: "14px",
  },
  tabButton: (active: boolean) => ({
    padding: "8px 16px",
    borderRadius: "8px",
    border: "1px solid",
    borderColor: active ? "#0066cc" : "#ddd",
    background: active ? "#0066cc" : "#fff",
    color: active ? "#fff" : "#333",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
  }),
} as const;
