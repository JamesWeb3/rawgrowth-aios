-- v3: departments are free-form; the manager-creation UI lets users name a department
-- whatever they want. The legacy enum-style check (marketing/sales/...) was rejecting
-- valid names like "Research" or "Engineering". Drop the check; UI normalizes display.

alter table rgaios_agents drop constraint if exists rgaios_agents_department_check;
