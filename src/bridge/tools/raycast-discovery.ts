import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import open from 'open';
import type { SystemTool } from './types.js';

interface DiscoveredCommand {
  extensionName: string;
  extensionAuthor: string;
  commandName: string;
  extensionId: string;
}

interface ExtensionMetadata {
  name: string;
  title: string;
  author: string;
  owner?: string;
  description?: string;
  commands: CommandMetadata[];
}

interface CommandMetadata {
  name: string;
  title: string;
  description?: string;
  mode?: string;
  arguments?: ArgumentMetadata[];
}

interface ArgumentMetadata {
  name: string;
  type: string;
  placeholder?: string;
  required?: boolean;
  description?: string;
}

interface CachedExtensions {
  timestamp: number;
  extensions: Record<string, ExtensionMetadata>;
}

const CACHE_FILE = join(homedir(), '.system-raycast-cache.json');
const CACHE_TTL = 24 * 60 * 60 * 1000;

const KNOWN_AUTHORS: Record<string, string> = {
  linear: 'linear',
  slack: 'mommertf',
  'spotify-player': 'mattisssa',
  twitter: 'tonka3000',
  github: 'raycast',
  screenshot: 'Aayush9029',
  'youtube-search': 'muuvmuuv',
  notion: 'notion',
  figma: 'figma',
  arc: 'the-browser-company',
  todoist: 'doist',
  obsidian: 'marcjulian',
  'visual-studio-code': 'thomas',
  brew: 'nhojb',
  docker: 'priithaamer',
  '1password': '1password',
  'google-chrome': 'nicholasly',
  calendar: 'raycast',
  'clipboard-history': 'raycast',
};

function readCache(): CachedExtensions | null {
  try {
    if (existsSync(CACHE_FILE)) {
      const content = readFileSync(CACHE_FILE, 'utf-8');
      const cache = JSON.parse(content) as CachedExtensions;
      if (Date.now() - cache.timestamp < CACHE_TTL) {
        return cache;
      }
    }
  } catch {}
  return null;
}

function writeCache(extensions: Record<string, ExtensionMetadata>): void {
  try {
    const cache: CachedExtensions = { timestamp: Date.now(), extensions };
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {}
}

export function discoverInstalledCommands(): DiscoveredCommand[] {
  try {
    const output = execSync(
      'defaults read com.raycast.macos alwaysAllowCommandDeeplinking 2>/dev/null',
      {
        encoding: 'utf-8',
        timeout: 5000,
      }
    );

    const commands: DiscoveredCommand[] = [];
    const regex = /"extension_([^.]+)\.([^_]+)__([^"]+)"\s*=\s*1;/g;
    let match;

    while ((match = regex.exec(output)) !== null) {
      const [, extensionName, commandName, extensionId] = match;
      const normalizedExtName = extensionName.replace(/-/g, '-');
      const author = KNOWN_AUTHORS[normalizedExtName] || normalizedExtName;

      commands.push({
        extensionName: extensionName.replace(/-/g, '_'),
        extensionAuthor: author,
        commandName,
        extensionId,
      });
    }

    return commands;
  } catch {
    return [];
  }
}

export async function fetchExtensionMetadata(
  author: string,
  name: string
): Promise<ExtensionMetadata | null> {
  try {
    const response = await fetch(`https://www.raycast.com/api/v1/extensions/${author}/${name}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'SYSTEM-Bridge/1.0' },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      name: string;
      title: string;
      author: { handle: string };
      owner?: { slug: string };
      description?: string;
      commands?: Array<{
        name: string;
        title: string;
        description?: string;
        mode?: string;
        arguments?: ArgumentMetadata[];
      }>;
    };

    return {
      name: data.name,
      title: data.title,
      author: data.author?.handle || author,
      owner: data.owner?.slug,
      description: data.description,
      commands: data.commands || [],
    };
  } catch {
    return null;
  }
}

export async function discoverAndGenerateTools(): Promise<{
  tools: SystemTool[];
  extensions: ExtensionMetadata[];
  fromCache: boolean;
}> {
  const discoveredCommands = discoverInstalledCommands();

  if (discoveredCommands.length === 0) {
    return { tools: [], extensions: [], fromCache: false };
  }

  const cache = readCache();
  if (cache) {
    const tools = generateToolsFromMetadata(cache.extensions, discoveredCommands);
    return { tools, extensions: Object.values(cache.extensions), fromCache: true };
  }

  const uniqueExtensions = new Map<string, { author: string; name: string }>();
  for (const cmd of discoveredCommands) {
    const extNameForApi = cmd.extensionName.replace(/_/g, '-');
    const key = `${cmd.extensionAuthor}/${extNameForApi}`;
    if (!uniqueExtensions.has(key)) {
      uniqueExtensions.set(key, { author: cmd.extensionAuthor, name: extNameForApi });
    }
  }

  const extensionMetadata: Record<string, ExtensionMetadata> = {};

  await Promise.all(
    Array.from(uniqueExtensions.entries()).map(async ([key, ext]) => {
      const metadata = await fetchExtensionMetadata(ext.author, ext.name);
      if (metadata) {
        extensionMetadata[key] = metadata;
      }
    })
  );

  writeCache(extensionMetadata);

  const tools = generateToolsFromMetadata(extensionMetadata, discoveredCommands);
  return { tools, extensions: Object.values(extensionMetadata), fromCache: false };
}

function generateToolsFromMetadata(
  extensionMetadata: Record<string, ExtensionMetadata>,
  discoveredCommands: DiscoveredCommand[]
): SystemTool[] {
  const tools: SystemTool[] = [];

  for (const cmd of discoveredCommands) {
    const extNameForApi = cmd.extensionName.replace(/_/g, '-');
    const key = `${cmd.extensionAuthor}/${extNameForApi}`;
    const extMeta = extensionMetadata[key];

    const cmdMeta = extMeta?.commands?.find(
      (c) =>
        c.name === cmd.commandName ||
        c.name === cmd.commandName.replace(/_/g, '-') ||
        c.name.replace(/-/g, '') === cmd.commandName.replace(/-/g, '')
    );

    const toolName = `${cmd.extensionName}_${cmd.commandName}`;
    const extensionOwner = extMeta?.owner || extMeta?.author || cmd.extensionAuthor;
    const extensionNameForUrl = cmd.extensionName.replace(/_/g, '-');

    const properties: Record<string, unknown> = {
      text: { type: 'string', description: 'Text to pre-fill in the command (optional)' },
    };
    const required: string[] = [];

    if (cmdMeta?.arguments) {
      for (const arg of cmdMeta.arguments) {
        properties[arg.name] = {
          type: arg.type === 'dropdown' ? 'string' : arg.type,
          description: arg.description || arg.placeholder || arg.name,
        };
        if (arg.required) {
          required.push(arg.name);
        }
      }
    }

    const description = cmdMeta?.description
      ? `${cmdMeta.title}: ${cmdMeta.description}`
      : `Raycast: ${extMeta?.title || cmd.extensionName} → ${cmdMeta?.title || cmd.commandName}`;

    tools.push({
      name: toolName,
      description,
      inputSchema: {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      },
      handler: async (args) => {
        let url = `raycast://extensions/${extensionOwner}/${extensionNameForUrl}/${cmd.commandName}`;
        const params = new URLSearchParams();

        const explicitArgs: Record<string, unknown> = {};
        for (const [argKey, value] of Object.entries(args)) {
          if (argKey !== 'text' && value !== undefined && value !== null && value !== '') {
            explicitArgs[argKey] = value;
          }
        }

        if (Object.keys(explicitArgs).length > 0) {
          params.set('arguments', JSON.stringify(explicitArgs));
        }

        const text = args['text'];
        if (typeof text === 'string' && text.length > 0 && Object.keys(explicitArgs).length === 0) {
          params.set('fallbackText', text);
        }

        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;

        await open(url);
        return {
          content: [
            { type: 'text', text: `Executed: ${cmdMeta?.title || cmd.commandName} (${url})` },
          ],
        };
      },
    });
  }

  return tools;
}

export function createDiscoveryTool(): SystemTool {
  return {
    name: 'raycast_discover',
    description:
      'Discover installed Raycast extensions and their available commands. Use refresh=true after installing new extensions.',
    inputSchema: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: 'Force refresh from Raycast API (clears cache)' },
      },
    },
    handler: async (args) => {
      if (args.refresh) {
        try {
          unlinkSync(CACHE_FILE);
        } catch {}
      }

      const { extensions, fromCache } = await discoverAndGenerateTools();

      if (extensions.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: "No Raycast extensions discovered. Make sure Raycast is installed and you've used some extension commands (they need deeplink permission).",
            },
          ],
        };
      }

      const summary = extensions
        .map((ext) => {
          const cmds = ext.commands.map((c) => `  • ${c.name}: ${c.title}`).join('\n');
          return `**${ext.title}** (${ext.owner || ext.author}/${ext.name})\n${cmds}`;
        })
        .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${extensions.length} extension(s)${fromCache ? ' (cached)' : ''}:\n\n${summary}`,
          },
        ],
      };
    },
  };
}

let cachedTools: SystemTool[] | null = null;

export async function getDiscoveredRaycastTools(): Promise<SystemTool[]> {
  if (cachedTools) return cachedTools;
  const { tools } = await discoverAndGenerateTools();
  cachedTools = tools;
  return tools;
}

export function clearToolCache(): void {
  cachedTools = null;
}
