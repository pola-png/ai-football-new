import 'package:appwrite/appwrite.dart' as appwrite;
import 'package:flutter/material.dart';

import 'account_deletion_service.dart';
import 'app_auth_service.dart';

class AccountDeletionPage extends StatefulWidget {
  const AccountDeletionPage({super.key});

  @override
  State<AccountDeletionPage> createState() => _AccountDeletionPageState();
}

class _AccountDeletionPageState extends State<AccountDeletionPage> {
  final _reasonController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _deleting = false;

  @override
  void dispose() {
    _reasonController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _deleteAccount() async {
    if (_deleting) {
      return;
    }

    final confirmText = _confirmController.text.trim().toUpperCase();
    if (confirmText != 'DELETE') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Type DELETE to confirm account removal.')),
      );
      return;
    }

    setState(() {
      _deleting = true;
    });

    try {
      await AccountDeletionService.instance.deleteAccount(
        reason: _reasonController.text.trim(),
      );

      await AppAuthService.instance.signOut();

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Your account has been deleted.')),
      );

      Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (error) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Deletion failed: ${_formatError(error)}')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _deleting = false;
        });
      }
    }
  }

  String _formatError(Object error) {
    if (error is appwrite.AppwriteException) {
      final details = <String>[
        if (error.type != null && error.type!.isNotEmpty) error.type!,
        if (error.message != null && error.message!.isNotEmpty) error.message!,
        if (error.code != null) 'Code ${error.code}',
      ];
      if (details.isNotEmpty) {
        return details.join(' - ');
      }
      return error.toString();
    }

    return error.toString();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final surface = isDark ? const Color(0xFF121B2E) : Colors.white;
    final border = isDark ? const Color(0xFF1E2B4C) : const Color(0xFFE2EAF2);
    final primaryText = isDark ? Colors.white : const Color(0xFF0F1A2C);
    final secondaryText = isDark ? const Color(0xFF8C9FB8) : const Color(0xFF5A6E85);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Delete Account'),
        backgroundColor: surface,
      ),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: isDark
                ? const [Color(0xFF0A0F1E), Color(0xFF10172A), Color(0xFF17233E)]
                : const [Color(0xFFF5F7FB), Color(0xFFE9EDF5), Color(0xFFDEE5EE)],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Permanently remove your account and stored profile data.',
              style: TextStyle(
                color: secondaryText,
                fontSize: 15,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: surface,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'What will be removed',
                    style: TextStyle(
                      color: primaryText,
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _bullet('Appwrite auth account'),
                  _bullet('Profile row in `user_profiles`'),
                  _bullet('Comments, selections, check-ins, and challenge entries'),
                  _bullet('Signed-in session on this device'),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF4F4),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: const Color(0xFFFFD0D0)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Important',
                    style: TextStyle(
                      color: primaryText,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'This cannot be undone. If you want to keep your account, leave this page without confirming DELETE.',
                    style: TextStyle(
                      color: secondaryText,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _reasonController,
              maxLines: 3,
              decoration: InputDecoration(
                labelText: 'Reason for deletion',
                hintText: 'Optional feedback',
                filled: true,
                fillColor: surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _confirmController,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(
                labelText: 'Type DELETE to confirm',
                filled: true,
                fillColor: surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: _deleting ? null : _deleteAccount,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFFF4D4D),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              icon: _deleting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.delete_forever_outlined),
              label: Text(_deleting ? 'Deleting...' : 'Delete My Account'),
            ),
            const SizedBox(height: 10),
            Text(
              'If you changed your mind, just go back. No action happens until you type DELETE and press the button.',
              style: TextStyle(color: secondaryText, fontSize: 12.5, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bullet(String text) {
    final secondaryText = Theme.of(context).brightness == Brightness.dark
        ? const Color(0xFF8C9FB8)
        : const Color(0xFF5A6E85);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('- ', style: TextStyle(fontSize: 18, height: 1.2)),
          Expanded(
            child: Text(
              text,
              style: TextStyle(color: secondaryText, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}
