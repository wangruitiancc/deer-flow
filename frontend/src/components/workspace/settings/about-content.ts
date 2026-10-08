/** Matrix-Law product boundary copy. */
import { APP_VERSION } from "@/version";

export const aboutMarkdown = `# Matrix-Law ${APP_VERSION}

Matrix-Law is a dedicated legal work system. Every runnable conversation belongs to an authorized tenant and a legal work item, which may be a case, one-off consultation, contract review, research task, or legal draft.

## Product boundary

- Tenant-scoped legal work is the only user workspace; non-legal generic chat is not a product capability.
- Tenant and legal-work context is validated by the server, not trusted from browser input.
- Generic agent creation, generic chat, channel, skill, tool, and sub-agent administration are not exposed as product capabilities.
- AI output is assistance for legal work and must be reviewed by an authorized professional.
`;
