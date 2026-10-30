//! The Claude session of one node in one run, and the herdr agent that holds it: the same
//! names `claude-spore` gives (src/session.ts, src/interactive.ts), so a run keeps its
//! conversations when its steps move to the runner module.

/// Fixed for good (docs/spec.md, p.18): a new namespace would cut every unfinished run off
/// from its conversations.
const NAMESPACE: [u8; 16] = [
    0x40, 0xc8, 0x2e, 0xf1, 0xaf, 0xd2, 0x4d, 0xda, 0xb0, 0x95, 0x47, 0x32, 0x75, 0x17, 0xb1, 0xdc,
];

/// Every visit and try of a node shares this conversation.
pub fn session_id(run_id: &str, node_id: &str) -> String {
    let mut sha = sha1_smol::Sha1::new();
    sha.update(&NAMESPACE);
    sha.update(format!("{run_id}/{node_id}").as_bytes());
    let mut bytes = sha.digest().bytes();
    // RFC 9562 §5.5: version 5, variant 10.
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes[..16].iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// herdr's name for the agent of one run and node: `[a-z][a-z0-9_-]{0,31}`.
pub fn agent_name(node_id: &str, session: &str) -> String {
    let slug: String = node_id
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .take(16)
        .collect();
    let compact: String = session.chars().filter(|c| *c != '-').take(10).collect();
    format!("sp-{slug}-{compact}")
}

/// Claude Code's folder for a project's transcripts: the path with every character that
/// is not an ASCII letter or digit made `-`.
pub fn project_folder(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}
