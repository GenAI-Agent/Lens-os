/**
 * Skill Parser
 * Parses user query for skill invocation (/skill_name query)
 * Uses skills loaded from API config
 */

import type { Skill } from '../../core/types';

export interface SkillParseResult {
  skill: Skill;
  skillPrompt: string;
  modifiedQuery: string;
}

export class SkillParser {
  private skills: Skill[] = [];

  setSkills(skills: Skill[]): void {
    this.skills = skills;
    console.log('[SkillParser] Loaded skills:', skills.map(s => s.name));
  }

  /**
   * Parse user query for skill invocation
   * Format: /skill_name (can appear anywhere in the query)
   * Returns: { skill, skillPrompt, modifiedQuery } or null
   */
  parseSkill(query: string): SkillParseResult | null {
    // Find /skill_name pattern anywhere in the query
    const match = query.match(/\/([a-z0-9_-]+)/i);

    if (!match) {
      return null;
    }

    const skillName = match[1];

    // Find skill in loaded skills
    const skill = this.skills.find(
      (s) => s.name.toLowerCase() === skillName.toLowerCase()
    );

    if (!skill) {
      console.warn(`[SkillParser] Skill not found: ${skillName}`);
      return null;
    }

    console.log(`[SkillParser] Found skill: ${skill.name}`);
    console.log(`[SkillParser] Skill prompt: ${skill.prompt.substring(0, 50)}...`);

    // Replace /skill_name with the skill prompt in the query
    const modifiedQuery = query.replace(`/${skillName}`, skill.prompt);

    return {
      skill,
      skillPrompt: skill.prompt,
      modifiedQuery,
    };
  }

  /**
   * Get all loaded skills
   */
  getSkills(): Skill[] {
    return this.skills;
  }

  /**
   * Get skill by name
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );
  }

  /**
   * List available skill names
   */
  listSkillNames(): string[] {
    return this.skills.map((s) => s.name);
  }
}
