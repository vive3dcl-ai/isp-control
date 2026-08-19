export type HuaweiOltProfile = {
  name: string;
  type: 'dba' | 'line' | 'srv';
  id: number | null;
  uploadKbps: number | null;
  downloadKbps: number | null;
  raw: string;
};

export function parseHuaweiDbaProfiles(text: string): HuaweiOltProfile[] {
  return parseProfiles(text, 'dba');
}
export function parseHuaweiLineProfiles(text: string): HuaweiOltProfile[] {
  return parseProfiles(text, 'line');
}
export function parseHuaweiSrvProfiles(text: string): HuaweiOltProfile[] {
  return parseProfiles(text, 'srv');
}
export function parseHuaweiProfiles(text: string): HuaweiOltProfile[] {
  return [
    ...parseHuaweiDbaProfiles(text),
    ...parseHuaweiLineProfiles(text),
    ...parseHuaweiSrvProfiles(text),
  ];
}

function parseProfiles(
  text: string,
  type: HuaweiOltProfile['type'],
): HuaweiOltProfile[] {
  const profiles: HuaweiOltProfile[] = [];
  const blocks = text.split(
    /(?=(?:profile-name|profile\s+name|dba-profile|ont-(?:line|srv)profile)\s*[:=])/i,
  );
  for (const block of blocks) {
    const name = block
      .match(/(?:profile-name|profile\s+name|name)\s*[:=]\s*([^\r\n]+)/i)?.[1]
      ?.trim();
    if (!name) continue;
    const id = block.match(
      /(?:profile-id|profile\s+id|id)\s*[:=]\s*(\d+)/i,
    )?.[1];
    const rates = [
      ...block.matchAll(
        /(?:fixed|assured|maximum|pir|cir|bandwidth)[^\d]*(\d+)\s*(?:kbit\/s|kbps)?/gi,
      ),
    ]
      .map((m) => Number(m[1]))
      .filter(Number.isFinite);
    profiles.push({
      name,
      type,
      id: id ? Number(id) : null,
      uploadKbps: type === 'dba' ? (rates.at(-1) ?? null) : null,
      downloadKbps: type === 'srv' ? (rates.at(-1) ?? null) : null,
      raw: block.trim(),
    });
  }
  return profiles;
}

export function mergeHuaweiSpeedProfiles(profiles: HuaweiOltProfile[]) {
  return profiles.map((profile) => ({
    name: profile.name,
    uploadProfile: profile.type === 'dba' ? profile.name : null,
    downloadProfile: profile.type === 'srv' ? profile.name : null,
    uploadKbps: profile.uploadKbps,
    downloadKbps: profile.downloadKbps,
    uploadMbps:
      profile.uploadKbps == null ? null : Math.round(profile.uploadKbps / 1024),
    downloadMbps:
      profile.downloadKbps == null
        ? null
        : Math.round(profile.downloadKbps / 1024),
    type: profile.type,
    id: profile.id,
  }));
}
