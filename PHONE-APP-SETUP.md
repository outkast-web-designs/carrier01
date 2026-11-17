# Carrier phone app: set up (free, about 10 minutes, once)

The app is a small website that you put on GitHub (free) and add to your phone's home screen.

## 1. Put it on GitHub
1. Make a free account at github.com and sign in.
2. Press **+** (top right) > **New repository**. Name it `carrier`. Choose **Public** (Pages is free for public repositories). Press **Create repository**.
3. On the new page press **uploading an existing file**. Unzip `Carrier-phone-app.zip` on your computer, open the `carrier-app` folder, select everything inside it (including the `icons` folder) and drag it into the page. Press **Commit changes**.
4. Go to **Settings > Pages**. Under Branch choose `main` and folder `/ (root)`, then Save.
5. After a minute the page shows your address, like `https://YOURNAME.github.io/carrier/`.

The app holds no private data. It is only the screens. Your emails and leads never go to GitHub.

## 2. Connect it to your sender
1. Update your Carrier extension on the computer (copy the new files over the old folder, reload it) and update your sender code: Sender tab > Copy sender code > paste it over the old code in Apps Script > run `setup` > Deploy > Manage deployments > edit > New version.
2. In Carrier, Sender tab, **Use Carrier on your phone**: type your app address and press **Copy my phone link**.
3. Send that link to yourself (WhatsApp works) and open it on your phone in Chrome. It connects by itself.
4. In Chrome press the three dots > **Add to Home screen** (or **Install app**).

## Keep in mind
- The phone link contains the key to your sender. Treat it like a password and do not share it. If it leaks, make a new sender secret in the extension (Sender tab) and copy a new phone link.
- Use it on one phone you trust.
