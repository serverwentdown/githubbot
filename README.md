
# GitHub Bot

A simple Telegram Bot to notify of events. Works with both private and public repositories using Webhooks.

# Usage

Add @serverwentdown_githubbot to your chat and type "/setup@serverwentdown_githubbot"

# Limitations

Webhook URLs can't be revoked, thus be careful when sharing them. This is a result of the stateless implementation of this bot. 

# Configuring Your Own Instance

Run in Docker with the below command. Remember to configure the required environmental variables. 

```
docker run --rm -it -p 8080:8080 -e ... serverwentdown/githubbot
```

## Environmental Variables

### `TELEGRAM_TOKEN`

This variable is mandatory. Specify your telegram bot token. Use @BotFather to obtain this.

### `TELEGRAM_SECRET`

This variable is mandatory. Generate a random string of length greater that 12 for this. It is used as an internal secret by the bot to secure communication with Telegram. 

### `GITHUBBOT_BASE_URL`

This variable is mandatory. This is the base URL that must be externally accessible by your bot, without a trailing slash. If you mount your bot on a different path with a reverse proxy, include the directory in the base URL.

### `GITHUBBOT_SECRET`

This variable is mandatory. Generate a random string of length greater that 12 for this. It is used as an internal secret to authenticate Webhook URLs. 

