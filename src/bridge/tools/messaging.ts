/**
 * Messaging Tools - iMessage and Contacts
 */

import { existsSync, readFileSync } from 'fs';
import { SystemTool } from './types.js';
import { execCommand, runAppleScript } from './utils/command.js';

export const messagingTools: SystemTool[] = [
  {
    name: 'read_imessages',
    description: 'READ/VIEW iMessages - use this when user wants to see, check, or read messages. Use for: "what did X send", "show messages from X", "read my messages", "last texts from X". Pass phone number directly if known, or contact name to look up.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Phone number (preferred) or contact name to filter messages. Leave empty for all recent.' },
        limit: { type: 'number', description: 'Number of messages to retrieve (default: 10, max: 50)' },
        includeImages: { type: 'boolean', description: 'Include image attachments in response (default: false)' }
      }
    },
    handler: async (args) => {
      let from = args.from ? String(args.from).replace(/"/g, '\\"') : '';
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
      const includeImages = args.includeImages === true;
      
      try {
        const homeDir = process.env.HOME || '/tmp';
        const dbPath = `${homeDir}/Library/Messages/chat.db`;
        
        if (!existsSync(dbPath)) {
          return { 
            content: [{ type: 'text', text: 'Messages database not found. Make sure Messages app has been used on this Mac.' }], 
            isError: true 
          };
        }
        
        // If 'from' looks like a name (not a phone number), try to look up the contact first
        if (from && !/^[\d\+\-\(\)\s]+$/.test(from)) {
          try {
            const contactScript = `
              tell application "Contacts"
                set matchingPeople to (every person whose name contains "${from}")
                if (count of matchingPeople) > 0 then
                  set thePerson to item 1 of matchingPeople
                  set thePhones to phones of thePerson
                  if (count of thePhones) > 0 then
                    return value of item 1 of thePhones
                  end if
                end if
                return ""
              end tell
            `;
            const phoneResult = await runAppleScript(contactScript);
            if (phoneResult && phoneResult.trim()) {
              from = phoneResult.trim().replace(/[\s\-\(\)]/g, '');
            }
          } catch {
            // Continue with the name as-is
          }
        }
        
        let sql = `
          SELECT 
            datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as date,
            CASE WHEN m.is_from_me = 1 THEN 'Me' ELSE coalesce(h.id, 'Unknown') END as sender,
            m.text,
            m.ROWID as msg_id,
            (SELECT GROUP_CONCAT(a.filename, '|||') 
             FROM message_attachment_join maj 
             JOIN attachment a ON maj.attachment_id = a.ROWID 
             WHERE maj.message_id = m.ROWID) as attachments
          FROM message m
          LEFT JOIN handle h ON m.handle_id = h.ROWID
          WHERE 1=1
        `;
        
        if (from) {
          const cleanPhone = from.replace(/[^0-9]/g, '');
          sql += ` AND (h.id LIKE '%${cleanPhone}%' OR h.id LIKE '%${from}%')`;
        }
        
        sql += ` ORDER BY m.date DESC LIMIT ${limit}`;
        
        const { stdout, stderr } = await execCommand('sqlite3', ['-separator', ' | ', dbPath, sql]);
        
        if (stderr && stderr.includes('unable to open database')) {
          return { 
            content: [{ type: 'text', text: 'Cannot access Messages database. Grant Full Disk Access to Terminal/the bridge app in System Preferences > Privacy & Security > Full Disk Access.' }], 
            isError: true 
          };
        }
        
        if (!stdout.trim()) {
          return { content: [{ type: 'text', text: from ? `No messages found from "${from}"` : 'No recent messages found' }] };
        }
        
        const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];
        const lines = stdout.trim().split('\n');
        let textOutput = '';
        
        for (const line of lines) {
          const parts = line.split(' | ');
          const date = parts[0];
          const sender = parts[1];
          const text = parts[2] || '';
          const attachments = parts[4] || '';
          
          let msgLine = `[${date}] ${sender}: ${text || '(no text)'}`;
          
          if (attachments) {
            const files = attachments.split('|||').filter(Boolean);
            const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|heic)$/i.test(f));
            const otherFiles = files.filter(f => !/\.(jpg|jpeg|png|gif|heic)$/i.test(f));
            
            if (imageFiles.length > 0) {
              msgLine += ` [${imageFiles.length} image(s)]`;
            }
            if (otherFiles.length > 0) {
              msgLine += ` [${otherFiles.length} attachment(s)]`;
            }
            
            if (includeImages && imageFiles.length > 0) {
              for (const imgPath of imageFiles.slice(0, 2)) {
                try {
                  const fullPath = imgPath.replace('~', homeDir);
                  if (existsSync(fullPath)) {
                    const imgBuffer = readFileSync(fullPath);
                    const ext = imgPath.split('.').pop()?.toLowerCase();
                    const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
                    
                    content.push({
                      type: 'text',
                      text: `\n--- Image from ${sender} at ${date} ---`
                    });
                    content.push({
                      type: 'image',
                      data: imgBuffer.toString('base64'),
                      mimeType
                    });
                  }
                } catch {}
              }
            }
          }
          
          textOutput += msgLine + '\n';
        }
        
        content.unshift({ type: 'text', text: textOutput.trim() });
        
        return { content };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error reading messages: ${error instanceof Error ? error.message : 'Unknown'}. Make sure Full Disk Access is granted in System Preferences > Privacy.` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'send_imessage',
    description: 'SEND iMessage - use this when user wants to send/text someone. Pass phone number directly if known, or contact name to look up.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Phone number (preferred) or contact name of the recipient' },
        message: { type: 'string', description: 'The message to send' }
      },
      required: ['to', 'message']
    },
    handler: async (args) => {
      let to = String(args.to).replace(/"/g, '\\"');
      const message = String(args.message).replace(/"/g, '\\"');
      
      if (!to || !message) {
        return { content: [{ type: 'text', text: 'Error: Both "to" and "message" are required' }], isError: true };
      }
      
      try {
        if (!/^[\d\+\-\(\)\s]+$/.test(to)) {
          try {
            const contactScript = `
              tell application "Contacts"
                set matchingPeople to (every person whose name contains "${to}")
                if (count of matchingPeople) > 0 then
                  set thePerson to item 1 of matchingPeople
                  set thePhones to phones of thePerson
                  if (count of thePhones) > 0 then
                    return value of item 1 of thePhones
                  end if
                end if
                return ""
              end tell
            `;
            const phoneResult = await runAppleScript(contactScript);
            if (phoneResult && phoneResult.trim()) {
              to = phoneResult.trim();
            } else {
              return { 
                content: [{ type: 'text', text: `Could not find phone number for contact "${args.to}". Try using a phone number directly.` }], 
                isError: true 
              };
            }
          } catch {
            return { 
              content: [{ type: 'text', text: `Could not look up contact "${args.to}". Try using a phone number directly.` }], 
              isError: true 
            };
          }
        }
        
        const script = `
          tell application "Messages"
            set targetService to 1st account whose service type = iMessage
            set targetBuddy to participant "${to}" of targetService
            send "${message}" to targetBuddy
          end tell
        `;
        await runAppleScript(script);
        return { content: [{ type: 'text', text: `Message sent to ${args.to}${to !== args.to ? ` (${to})` : ''}` }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error sending message: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  },
  {
    name: 'search_contacts',
    description: 'Search for contacts by name to find their phone number or email. Pass the person\'s actual name.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name to search for (e.g., "John Smith", "Mom", "Jane")' },
        name: { type: 'string', description: 'Alias for query - name to search for' }
      },
      required: ['query']
    },
    handler: async (args) => {
      const rawQuery = args.query || args.name;
      
      if (!rawQuery || String(rawQuery) === 'undefined') {
        return { 
          content: [{ type: 'text', text: 'Error: Please provide a name to search for' }], 
          isError: true 
        };
      }
      const query = String(rawQuery).replace(/"/g, '\\"');
      
      try {
        const script = `
          tell application "Contacts"
            launch
            delay 0.5
            set matchingPeople to (every person whose name contains "${query}")
            if (count of matchingPeople) = 0 then
              return "No contacts found"
            end if
            set output to ""
            repeat with thePerson in matchingPeople
              set theName to name of thePerson
              set output to output & theName
              try
                set phoneList to value of phones of thePerson
                if (count of phoneList) > 0 then
                  set output to output & " | Phone: " & (item 1 of phoneList)
                end if
              end try
              try
                set emailList to value of emails of thePerson
                if (count of emailList) > 0 then
                  set output to output & " | Email: " & (item 1 of emailList)
                end if
              end try
              set output to output & return
            end repeat
            return output
          end tell
        `;
        const result = await runAppleScript(script);
        if (!result || result.trim() === '' || result.includes('No contacts found')) {
          return { content: [{ type: 'text', text: `No contacts found matching "${query}"` }] };
        }
        return { content: [{ type: 'text', text: result.trim() }] };
      } catch (error) {
        return { 
          content: [{ type: 'text', text: `Error searching contacts: ${error instanceof Error ? error.message : 'Unknown'}` }], 
          isError: true 
        };
      }
    }
  }
];
