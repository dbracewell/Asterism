# First-time setup

The first person to open a new Asterism creates the administrator account, then
connects the AI models everyone will use. This page walks through those first
steps in the browser.

> **Who can do this:** the administrator, once, when Asterism is new.

Installing and running the server is covered in the
[deployment guide](../../deployment.md). This page starts when the server is
running and you open its address for the first time.

## Before you start

- **The admin passkey.** Whoever installed Asterism set it on the server
  (`ADMIN_PASSPHRASE`). You need it once, to prove you're the administrator.
- **A model provider.** For example an OpenAI API key, or the address of an
  OpenAI-compatible server your school runs.

## Step 1: Create the administrator account

1. Open Asterism's address. It says **Set up your Asterism instance**.

   ![The first-run sign-up form, asking for the administrator's name, email, password and the admin passkey](../images/setup-admin-account.png)

2. Type your **Name**, **Email** and a **Password**.
3. Type the **Admin Passkey**.
4. Select **Sign up**.

## Step 2: Connect a model provider

1. Choose the **Provider type**:
   - **OpenAI** uses the OpenAI API.
   - **OpenAI-compatible** is any other server that works the same way, hosted
     or on your own network.
2. Give the provider a **Provider name** that people will recognize.
3. For OpenAI-compatible, type its **Base URL**.
4. Type the **API key**. A local server that doesn't check keys accepts any value.

   ![The setup card for connecting a model provider, with OpenAI-compatible selected and a base URL filled in](../images/setup-connect-provider.png)

5. Select **Connect and discover models**. Asterism asks the provider which
   models it has.

## Step 3: Enable models

1. Tick the models people may use. For each, tick **Tools** if the model can use
   tools: file search, sub-agents, the canvas and images need it.

   ![The setup card listing the models the provider offers, with a default model and a draft model chosen](../images/setup-enable-models.png)

2. Choose the **Default model**, which new chats start with.
3. Choose the **Draft model**, which writes chat titles and other short background
   tasks for everyone. A small, fast model works best.
4. Select **Continue**, then **Start chatting**.

To set this up later instead, select **Skip for now**. You can add providers and
models at any time in **Admin Settings** › **Providers**.

## What to do next

- [Users and accounts](users-and-accounts.md): how people get accounts.
- [Groups, budgets and usage](groups-budgets-and-usage.md): limit models or set
  token budgets for students.
- [Policies](policies.md): turn on skills, the canvas, image creation and other
  features, which start off.
- Take a first backup, as the [deployment guide](../../deployment.md) explains.

## If something goes wrong

- **"The provider returned no models."** Check the base URL (it usually ends in
  `/v1`) and the API key, then try again.
- **The passkey is refused.** Check it with whoever installed Asterism. It's the
  `ADMIN_PASSPHRASE` value in the server's settings.

## Related

- [Providers and models](providers-and-models.md)
