import type { SystemTool } from './types.js';
import { runAppleScript } from './utils/command.js';

async function getRunningApps(): Promise<string> {
  const script = `
    set output to ""
    tell application "System Events"
      repeat with proc in (every application process whose background only is false)
        set procName to name of proc
        set procBundle to bundle identifier of proc
        set isFront to frontmost of proc
        set output to output & procName & "|" & procBundle & "|" & isFront & linefeed
      end repeat
    end tell
    return output
  `;
  return await runAppleScript(script);
}

async function getFrontmostAppElements(maxElements: number = 50): Promise<string> {
  const script = `
    set output to ""
    set elemCount to 0
    set maxElems to ${maxElements}
    
    tell application "System Events"
      set frontProc to first application process whose frontmost is true
      set procName to name of frontProc
      set procBundle to bundle identifier of frontProc
      set output to output & "APP:" & procName & "|" & procBundle & linefeed
      
      try
        repeat with win in (windows of frontProc)
          set winTitle to ""
          try
            set winTitle to title of win
          end try
          set winPos to position of win
          set winSize to size of win
          set output to output & "WINDOW:" & winTitle & "|" & (item 1 of winPos) & "," & (item 2 of winPos) & "|" & (item 1 of winSize) & "," & (item 2 of winSize) & linefeed
          
          try
            set allElems to entire contents of win
            repeat with elem in allElems
              if elemCount < maxElems then
                try
                  set elemRole to role of elem
                  set elemTitle to ""
                  set elemDesc to ""
                  set elemValue to ""
                  try
                    set elemTitle to title of elem
                  end try
                  try
                    set elemDesc to description of elem
                  end try
                  try
                    set elemValue to value of elem
                    if class of elemValue is not text then
                      set elemValue to ""
                    end if
                  end try
                  set elemPos to {0, 0}
                  set elemSize to {0, 0}
                  try
                    set elemPos to position of elem
                    set elemSize to size of elem
                  end try
                  if (item 1 of elemSize) > 0 and (item 2 of elemSize) > 0 then
                    set output to output & "ELEM:" & elemRole & "|" & elemTitle & "|" & elemDesc & "|" & elemValue & "|" & (item 1 of elemPos) & "," & (item 2 of elemPos) & "|" & (item 1 of elemSize) & "," & (item 2 of elemSize) & linefeed
                    set elemCount to elemCount + 1
                  end if
                end try
              end if
            end repeat
          end try
        end repeat
      end try
    end tell
    return output
  `;
  return await runAppleScript(script);
}

async function findElements(role: string, titleFilter?: string): Promise<string> {
  const script = `
    set output to ""
    tell application "System Events"
      set frontProc to first application process whose frontmost is true
      
      repeat with win in (windows of frontProc)
        try
          set allElems to entire contents of win
          set foundCount to 0
          repeat with elem in allElems
            if foundCount < 20 then
              try
                set elemRole to role of elem
                if elemRole is "${role}" then
                  set elemTitle to ""
                  set elemDesc to ""
                  try
                    set elemTitle to title of elem
                  end try
                  try
                    set elemDesc to description of elem
                  end try
                  ${titleFilter ? `if elemTitle contains "${titleFilter}" or elemDesc contains "${titleFilter}" then` : ''}
                    set elemPos to {0, 0}
                    set elemSize to {0, 0}
                    try
                      set elemPos to position of elem
                      set elemSize to size of elem
                    end try
                    set output to output & elemRole & "|" & elemTitle & "|" & elemDesc & "|" & (item 1 of elemPos) & "," & (item 2 of elemPos) & "|" & (item 1 of elemSize) & "," & (item 2 of elemSize) & linefeed
                    set foundCount to foundCount + 1
                  ${titleFilter ? 'end if' : ''}
                end if
              end try
            end if
          end repeat
        end try
      end repeat
    end tell
    return output
  `;
  return await runAppleScript(script);
}

function parseAppList(
  output: string
): Array<{ name: string; bundleId: string; frontmost: boolean }> {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, bundleId, frontmost] = line.split('|');
      return { name, bundleId, frontmost: frontmost === 'true' };
    });
}

interface UIElement {
  role: string;
  title?: string;
  description?: string;
  value?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  center: { x: number; y: number };
}

function parseElements(output: string): {
  app?: { name: string; bundleId: string };
  windows: Array<{
    title: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    elements: UIElement[];
  }>;
} {
  const lines = output.trim().split('\n').filter(Boolean);
  const result: ReturnType<typeof parseElements> = { windows: [] };
  let currentWindow: (typeof result.windows)[0] | null = null;

  for (const line of lines) {
    if (line.startsWith('APP:')) {
      const [name, bundleId] = line.slice(4).split('|');
      result.app = { name, bundleId };
    } else if (line.startsWith('WINDOW:')) {
      const [title, pos, size] = line.slice(7).split('|');
      const [x, y] = pos.split(',').map(Number);
      const [width, height] = size.split(',').map(Number);
      currentWindow = { title, position: { x, y }, size: { width, height }, elements: [] };
      result.windows.push(currentWindow);
    } else if (line.startsWith('ELEM:') && currentWindow) {
      const [role, title, desc, value, pos, size] = line.slice(5).split('|');
      const [x, y] = pos.split(',').map(Number);
      const [width, height] = size.split(',').map(Number);
      currentWindow.elements.push({
        role,
        title: title || undefined,
        description: desc || undefined,
        value: value || undefined,
        position: { x, y },
        size: { width, height },
        center: { x: Math.round(x + width / 2), y: Math.round(y + height / 2) },
      });
    }
  }

  return result;
}

function parseFoundElements(output: string): Array<{
  role: string;
  title?: string;
  description?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}> {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [role, title, desc, pos, size] = line.split('|');
      const [x, y] = pos.split(',').map(Number);
      const [width, height] = size.split(',').map(Number);
      return {
        role,
        title: title || undefined,
        description: desc || undefined,
        position: { x, y },
        size: { width, height },
      };
    });
}

export const accessibilityTools: SystemTool[] = [
  {
    name: 'ax_get_elements',
    description:
      'Get UI elements from the frontmost application. Returns windows and their UI elements with roles, titles, positions.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      try {
        const output = await getFrontmostAppElements();
        const result = parseElements(output);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'ax_find',
    description:
      'Find UI elements by role. Common roles: AXButton, AXTextField, AXStaticText, AXCheckBox, AXPopUpButton, AXMenuItem, AXLink, AXImage.',
    inputSchema: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description: 'Element role (e.g., "AXButton", "AXTextField")',
        },
        title: {
          type: 'string',
          description: 'Optional: filter by title (partial match)',
        },
      },
      required: ['role'],
    },
    handler: async (args) => {
      try {
        const output = await findElements(
          String(args.role),
          args.title ? String(args.title) : undefined
        );
        const result = parseFoundElements(output);
        return {
          content: [
            {
              type: 'text',
              text: `Found ${result.length} element(s):\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'ax_list_apps',
    description: 'List all running applications with their bundle IDs.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      try {
        const output = await getRunningApps();
        const result = parseAppList(output);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'ax_click_element',
    description:
      'Find a button or clickable element by title/description and click it. More reliable than coordinate clicking for known UI elements.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Button/element title or description to find and click',
        },
        role: {
          type: 'string',
          description:
            'Element role (default: AXButton). Use AXLink for links, AXMenuItem for menus.',
        },
      },
      required: ['title'],
    },
    handler: async (args) => {
      try {
        const title = String(args.title);
        const role = String(args.role || 'AXButton');
        const output = await findElements(role, title);
        const elements = parseFoundElements(output);

        if (elements.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No ${role} found with title/description containing "${title}"`,
              },
            ],
            isError: true,
          };
        }

        const elem = elements[0];
        const centerX = Math.round(elem.position.x + elem.size.width / 2);
        const centerY = Math.round(elem.position.y + elem.size.height / 2);

        const { execCommand } = await import('./utils/command.js');
        try {
          await execCommand('cliclick', [`c:${centerX},${centerY}`]);
        } catch {
          await runAppleScript(`
            tell application "System Events"
              click at {${centerX}, ${centerY}}
            end tell
          `);
        }

        return {
          content: [
            {
              type: 'text',
              text: `Clicked "${elem.title || elem.description}" at (${centerX}, ${centerY})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'ax_type_in_field',
    description:
      'Find a text field by title/description and type text into it. Automatically clicks the field first.',
    inputSchema: {
      type: 'object',
      properties: {
        field: { type: 'string', description: 'Text field name/description to find' },
        text: { type: 'string', description: 'Text to type' },
        clear: { type: 'boolean', description: 'Clear existing text first (Cmd+A before typing)' },
      },
      required: ['text'],
    },
    handler: async (args) => {
      try {
        const fieldName = args.field ? String(args.field) : '';
        const text = String(args.text);
        const clear = Boolean(args.clear);

        let centerX: number, centerY: number;

        if (fieldName) {
          const output = await findElements('AXTextField', fieldName);
          let elements = parseFoundElements(output);

          if (elements.length === 0) {
            const textAreaOutput = await findElements('AXTextArea', fieldName);
            elements = parseFoundElements(textAreaOutput);
          }

          if (elements.length === 0) {
            return {
              content: [{ type: 'text', text: `No text field found matching "${fieldName}"` }],
              isError: true,
            };
          }

          const elem = elements[0];
          centerX = Math.round(elem.position.x + elem.size.width / 2);
          centerY = Math.round(elem.position.y + elem.size.height / 2);

          const { execCommand } = await import('./utils/command.js');
          try {
            await execCommand('cliclick', [`c:${centerX},${centerY}`]);
          } catch {
            await runAppleScript(
              `tell application "System Events" to click at {${centerX}, ${centerY}}`
            );
          }
          await new Promise((r) => setTimeout(r, 100));
        }

        if (clear) {
          await runAppleScript(
            `tell application "System Events" to keystroke "a" using command down`
          );
          await new Promise((r) => setTimeout(r, 50));
        }

        const { execCommand } = await import('./utils/command.js');
        try {
          await execCommand('cliclick', [`t:${text}`]);
        } catch {
          await runAppleScript(
            `tell application "System Events" to keystroke "${text.replace(/"/g, '\\"')}"`
          );
        }

        return {
          content: [{ type: 'text', text: `Typed "${text}" in ${fieldName || 'focused field'}` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: 'ax_focused_element',
    description: 'Get information about the currently focused UI element.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const script = `
          tell application "System Events"
            tell (first application process whose frontmost is true)
              try
                set theElem to value of attribute "AXFocusedUIElement"
                if theElem is missing value then
                  return "NONE"
                end if
                set elemRole to role of theElem
                set elemTitle to ""
                set elemDesc to ""
                set elemValue to ""
                try
                  set elemTitle to title of theElem
                end try
                try
                  set elemDesc to description of theElem
                end try
                try
                  set elemValue to (value of theElem) as text
                on error
                  set elemValue to ""
                end try
                set elemPos to position of theElem
                set elemSize to size of theElem
                return elemRole & "|" & elemTitle & "|" & elemDesc & "|" & elemValue & "|" & (item 1 of elemPos) & "," & (item 2 of elemPos) & "|" & (item 1 of elemSize) & "," & (item 2 of elemSize)
              on error errMsg
                return "NONE"
              end try
            end tell
          end tell
        `;
        const result = await runAppleScript(script);

        if (result === 'NONE') {
          return { content: [{ type: 'text', text: 'No focused element' }] };
        }

        const [role, title, desc, value, pos, size] = result.split('|');
        const [x, y] = pos.split(',').map(Number);
        const [w, h] = size.split(',').map(Number);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  role,
                  title: title || undefined,
                  description: desc || undefined,
                  value: value || undefined,
                  position: { x, y },
                  size: { width: w, height: h },
                  center: { x: Math.round(x + w / 2), y: Math.round(y + h / 2) },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
];
