import fs from 'node:fs';
import { Telegraf, Input } from 'telegraf';
import { config } from './config.js';
import { validateMediaUrl } from './url-validator.js';
import { downloadMedia } from './downloader.js';

export function startBot() {
  if (!config.botToken) return null;
  const bot = new Telegraf(config.botToken);
  bot.start((ctx) => ctx.reply(`Selamat datang di ${config.name}!\n\nKirim link publik Facebook, Instagram, TikTok, YouTube, atau X. Pastikan Anda berhak mengunduh konten tersebut.`));
  bot.help((ctx) => ctx.reply('Cukup kirim satu URL publik. Konten privat, DRM, playlist, dan bypass akses tidak didukung.'));
  bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    const status = await ctx.reply('🔎 Memeriksa link...');
    try {
      const media = await validateMediaUrl(ctx.message.text);
      await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined, `⏳ Mengunduh dari ${media.platform}...`);
      const result = await downloadMedia({ ...media, source: 'telegram', userRef: String(ctx.from.id) });
      await ctx.replyWithDocument(Input.fromLocalFile(result.filePath, result.fileName), { caption: `✅ Selesai melalui ${config.name}` });
      fs.rm(result.filePath, { force: true }, () => {});
      await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    } catch (error) { await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined, `❌ ${error.message || 'Download gagal.'}`).catch(() => {}); }
  });
  bot.catch((error) => console.error('Telegram:', error.message));
  bot.launch();
  return bot;
}
