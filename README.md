# emmVRC_Server

Saw this on a repo a while back and took a copy, was planning on submitting a pull request but it seems the original repo has been taken down. You can figure out what to do to get it running from the code, it's very basic and probably very hackable.

So our new repo "VRC_Checkers" is now required for this to function. It's a MySQL backed PHP script which checks if a user ID and avatar ID is valid before sending it to the database. Why is it not baked into the server? because if we get IP banned / need to load balance it having it as a sperate app is easier.

Features:

Pin authentication,

Token generation for login, removal on logout,

Messaging,

Avatar searching and storing,

Rate limits so people can't crash you with message spams,

URL checks so users can't upload avatars that link to resources outside of VRChat,

Other stuff I probably forgot.



A public server has opened using this code, feel free to join their Discord at https://discord.gg/tTNk9tDsge
