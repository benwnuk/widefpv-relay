This server application provides a gateway for streaming content from the WideFPV web application to RTMP-based livestreaming platforms. By default, WideFPV uses a single shared, public gateway. By installing and configuring your own gateway, you can better assure availability and manage bandwidth to meet your needs.

### http://widefpv.com

Any Node environment should be able to host this server. Of note:
* A publicly reachable, encrypted URL is required for normal use. A placeholder page will be served at https://yourdomain, and the web socket server will be available at wss://yourdomain.
* To use this script from localhost, or a non-secure host, security flags will need to be manually overridden within the browser.

### To do:
* Add friendly UX to change gateway host
* Instructions how to update WideFPV
* Instructions how to install on Heroku or Railway

