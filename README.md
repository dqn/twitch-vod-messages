# twitch-vod-messages

Fetch Twitch VOD messages.

## Installation

```sh
npm install twitch-vod-messages
```

## Usage

### Basic Example

```ts
import { createTwitchClient } from "twitch-vod-messages";

const videoId = "0123456789";
const client = await createTwitchClient(videoId);

while (true) {
  const res = await client.fetchNext();

  for (const node of res.nodes) {
    console.log(
      node.contentOffsetSeconds,
      node.commenter?.displayName ?? "Anonymous",
      node.message.fragments.map((f) => f.text).join(""),
    );
  }

  if (!res.hasNextPage) {
    break;
  }
}
```

### With Offset

```ts
// Specify start offset in seconds
const client = await createTwitchClient("0123456789", 300); // Start from 5 minutes
```

## License

MIT
