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

`fetchAllMessages` automatically detects the video length by probing the video at multiple offsets. This works for videos up to 48 hours (the maximum duration of a Twitch VOD).

### With Options

You can specify the concurrency level and progress callback:

```ts
const messages = await fetchAllMessages(videoId, {
  concurrency: 10, // Default: 128
  onProgress: (progress) => {
    console.log(`Progress: ${progress.percentage}%`);
    console.log(
      `Completed: ${progress.completedChunks}/${progress.totalChunks}`,
    );
  },
});
```

### Manual Video Length

For longer videos (>5 hours) or to skip the probe phase for better performance, you can manually specify the video length:

```ts
const messages = await fetchAllMessages(videoId, {
  lengthSeconds: 36000, // 10 hours
  concurrency: 10,
});
```

### Fetch Messages by Offset

Fetch messages starting from a specific offset:

```ts
import { fetchMessages } from "twitch-vod-messages";

const videoId = "0123456789";
let contentOffsetSeconds = 0;

while (true) {
  const response = await fetchMessages(videoId, { contentOffsetSeconds });

  if (response.nodes.length === 0) {
    break;
  }

  for (const node of response.nodes) {
    console.log(
      node.contentOffsetSeconds,
      node.commenter?.displayName ?? "Anonymous",
      node.message.fragments.map((f) => f.text).join(""),
    );
  }

  const lastNode = response.nodes.at(-1);
  if (lastNode) {
    contentOffsetSeconds = lastNode.contentOffsetSeconds + 1;
  }
}
```

## License

MIT
