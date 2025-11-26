# twitch-vod-messages

Fetch Twitch VOD messages.

## Installation

```sh
npm install twitch-vod-messages
```

## Usage

### Fetch All Messages

Efficiently fetch all messages from a video using parallel requests:

```ts
import { fetchAllMessages } from "twitch-vod-messages";

const videoId = "0123456789";
const messages = await fetchAllMessages(videoId);

for (const node of messages) {
  console.log(
    node.contentOffsetSeconds,
    node.commenter?.displayName ?? "Anonymous",
    node.message.fragments.map((f) => f.text).join(""),
  );
}
```

### With Options

You can specify the concurrency level and progress callback:

```ts
const messages = await fetchAllMessages(videoId, {
  concurrency: 10, // Default: 5
  onProgress: (progress) => {
    console.log(`Progress: ${progress.percentage}%`);
    console.log(
      `Completed: ${progress.completedChunks}/${progress.totalChunks}`,
    );
  },
});
```

## License

MIT
