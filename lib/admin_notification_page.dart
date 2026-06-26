import 'dart:convert';

import 'package:flutter/material.dart';

import 'admin_access_service.dart';
import 'admin_notification_service.dart';

class AdminNotificationPage extends StatefulWidget {
  const AdminNotificationPage({super.key});

  @override
  State<AdminNotificationPage> createState() => _AdminNotificationPageState();
}

class _AdminNotificationPageState extends State<AdminNotificationPage> {
  final _titleController = TextEditingController();
  final _bodyController = TextEditingController();
  final _dataController = TextEditingController(text: '{"screen":"predictions"}');
  bool _sending = false;

  @override
  void dispose() {
    _titleController.dispose();
    _bodyController.dispose();
    _dataController.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_sending) {
      return;
    }

    final title = _titleController.text.trim();
    final body = _bodyController.text.trim();
    if (title.isEmpty || body.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Title and message are required.')),
      );
      return;
    }

    Map<String, String>? data;
    final rawData = _dataController.text.trim();
    if (rawData.isNotEmpty) {
      try {
        final parsed = Map<String, dynamic>.from(
          rawData.isEmpty ? <String, dynamic>{} : (jsonDecode(rawData) as Map),
        );
        data = parsed.map((key, value) => MapEntry(key, '$value'));
      } catch (_) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Notification data must be valid JSON.')),
        );
        return;
      }
    }

    setState(() {
      _sending = true;
    });

    try {
      await AdminNotificationService.instance.sendNotification(
        title: title,
        body: body,
        data: data,
      );
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Notification sent.')),
      );
      Navigator.of(context).maybePop();
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to send notification: $error')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _sending = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: AdminAccessService.instance,
      builder: (context, _) {
        final isAdmin = AdminAccessService.instance.isAdmin;
        if (!isAdmin) {
          return const Scaffold(
            body: Center(
              child: Text('Admin access required.'),
            ),
          );
        }

        final theme = Theme.of(context);
        final colors = theme.colorScheme;

        return Scaffold(
          appBar: AppBar(
            title: const Text('Admin Notification'),
          ),
          body: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  colors.surface,
                  colors.surfaceContainerHighest.withValues(alpha: 0.9),
                ],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  'Send a push notification to all subscribed users.',
                  style: theme.textTheme.titleMedium,
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: _titleController,
                  decoration: const InputDecoration(
                    labelText: 'Notification title',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _bodyController,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Notification message',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _dataController,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Optional data JSON',
                    helperText: 'Example: {"screen":"predictions","fixture_api_id":"123"}',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: _sending ? null : _send,
                  icon: _sending
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.send),
                  label: Text(_sending ? 'Sending...' : 'Send Notification'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
