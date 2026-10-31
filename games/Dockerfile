# The games/ tree is the site root, served by nginx on :80.
FROM nginx:1.30-alpine
COPY . /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
