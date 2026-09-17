import { Clock, Files } from "lucide-react";
import { harnessBadgeLabel, type SkillSummary } from "../shared";
import { PACKAGE_BANDS, packageBand } from "../package-metrics";
export const LENGTH_BANDS = PACKAGE_BANDS;
export const lengthBand = packageBand;
export function relativeAccess(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
export function HarnessBadge({ skill }: { skill: SkillSummary }) {
  const label = harnessBadgeLabel(skill.harnessPolicy);
  return label ? <span className="harness-badge">{label}</span> : null;
}
export function SkillMetrics({ skill }: { skill: SkillSummary }) {
  if (skill.characters === undefined) return null;
  const band = lengthBand(skill);
  const access = skill.lastAgentReadAt;
  return (
    <div className="skill-metrics">
      <div
        className="skill-length"
        title={`Whole package: ${skill.fileCount} files, ${skill.characters.toLocaleString()} text characters, ${((skill.packageBytes ?? 0) / 1024).toFixed(1)} KB. Entry: ${skill.entryCharacters?.toLocaleString()} chars. Icon artwork excluded. Largest limit determines level.`}
      >
        <span
          className={`length-pills level-${band + 1}`}
          role="meter"
          aria-label="Skill length"
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={band + 1}
          aria-valuetext={`${LENGTH_BANDS[band]!.label}: ${skill.characters.toLocaleString()} characters`}
        >
          {LENGTH_BANDS.map((b, i) => (
            <i key={b.label} className={i <= band ? "filled" : ""} />
          ))}
        </span>
        <span>{skill.characters.toLocaleString()} chars</span>
        <span
          className={`file-count file-rank-${(skill.fileCount ?? 0) <= 1 ? "green" : (skill.fileCount ?? 0) <= 3 ? "yellow" : (skill.fileCount ?? 0) <= 10 ? "orange" : "red"}`}
          title={`${skill.fileCount} content files; artwork excluded`}
        >
          <Files size={13} />
          <span className="sr-only">Files: </span>
          {skill.fileCount}
        </span>
      </div>
      <span
        className="last-access"
        title={
          access
            ? `Last agent read ${new Date(access).toLocaleString()} by ${skill.lastAgentReadBy ?? "a client"}. ${skill.readCount} reads; ${skill.usageCount} self-reported uses. Reading does not prove use.`
            : "No attributable agent reads since detailed tracking began. Legacy records are available in Activity."
        }
      >
        <Clock size={12} />{" "}
        {access ? `Read ${relativeAccess(access)}` : "No tracked agent reads"}
      </span>
      <span
        className="usage-count"
        title="Explicit self-reports from report_skill_use; not inferred from reads."
      >
        {skill.usageCount
          ? `${skill.usageCount} reported uses`
          : "No usage reports"}
      </span>
    </div>
  );
}
