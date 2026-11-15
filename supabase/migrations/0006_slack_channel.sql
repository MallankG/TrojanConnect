-- Slack replaces WhatsApp as the messaging channel; conversations started from Slack are stored with channel 'slack'.
alter table conversations drop constraint if exists conversations_channel_check;
alter table conversations add constraint conversations_channel_check
    check (channel in ('web', 'whatsapp', 'telegram', 'slack'));
