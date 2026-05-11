import { z } from "zod";

export const createServerSchema = z.discriminatedUnion("connectionType", [
  z.object({
    name: z.string().min(1),
    connectionType: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    workingDir: z.string().optional(),
    autoStart: z.boolean().optional(),
  }),
  z.object({
    name: z.string().min(1),
    connectionType: z.literal("http"),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    autoStart: z.boolean().optional(),
  }),
]);

export const serverOrderSchema = z
  .object({
    serverIds: z.array(z.string().min(1)).nonempty(),
  })
  .strict();

export const createProfileSchema = z.object({
  name: z.string().min(1),
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
});

export const updateProfileServerSchema = z.object({
  enabled: z.boolean().optional(),
  disabledTools: z.array(z.string()).optional(),
});

const generalSettingsUpdateSchema = z
  .object({
    autoStartOnLogin: z.boolean().optional(),
    autoStartServersOnLaunch: z.boolean().optional(),
    minimizeToTrayOnClose: z.boolean().optional(),
    showWindowOnLaunch: z.boolean().optional(),
  })
  .strict();

const appearanceSettingsUpdateSchema = z
  .object({
    theme: z.enum(["light", "dark", "system"]).optional(),
  })
  .strict();

const advancedSettingsUpdateSchema = z
  .object({
    logRetentionDays: z.number().int().min(0).max(365).optional(),
    enableAuditLogging: z.boolean().optional(),
    sidecarPort: z.number().int().min(1024).max(65535).optional(),
  })
  .strict();

export const settingsUpdateSchema = z
  .object({
    general: generalSettingsUpdateSchema.optional(),
    appearance: appearanceSettingsUpdateSchema.optional(),
    advanced: advancedSettingsUpdateSchema.optional(),
  })
  .strict();
