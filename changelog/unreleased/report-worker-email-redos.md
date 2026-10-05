### 🔒 Security

- **infra**: The abuse report Worker now checks a reply address in linear time and limits it to 254 characters, so a long crafted address no longer ties up a request. Reported by CodeQL as `js/polynomial-redos`.
