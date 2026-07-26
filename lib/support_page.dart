import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'app_auth_service.dart';
import 'admin_access_service.dart';
import 'support_service.dart';

class SupportPage extends StatelessWidget {
  const SupportPage({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: AdminAccessService.instance,
      builder: (context, _) {
        final isAdmin = AdminAccessService.instance.isAdmin;
        if (isAdmin) {
          return const AdminSupportDashboard();
        } else {
          final currentUser = AppAuthService.instance.currentUser;
          if (currentUser == null) {
            return const Scaffold(
              body: Center(
                child: Text('Please log in to contact support.'),
              ),
            );
          }
          return SupportChatRoom(
            roomId: currentUser.id,
            roomName: 'Support Chat',
            isAdminChat: false,
          );
        }
      },
    );
  }
}

// -------------------------------------------------------------
// Admin Support Dashboard (Lists all active chat rooms)
// -------------------------------------------------------------
class AdminSupportDashboard extends StatelessWidget {
  const AdminSupportDashboard({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final surfaceColor = isDark ? const Color(0xFF121B2E) : Colors.white;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Support Requests'),
        elevation: 0,
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
        child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: SupportService.instance.watchRooms(),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }

            if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.question_answer_outlined,
                      size: 64,
                      color: isDark ? const Color(0xFF5A6E85) : const Color(0xFF8C9FB8),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'No active support chats',
                      style: theme.textTheme.titleMedium?.copyWith(
                        color: isDark ? Colors.white70 : Colors.black87,
                      ),
                    ),
                  ],
                ),
              );
            }

            final docs = snapshot.data!.docs;

            return ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              itemCount: docs.length,
              itemBuilder: (context, index) {
                final data = docs[index].data();
                final userId = data['userId'] as String? ?? '';
                final userName = data['userName'] as String? ?? 'Anonymous';
                final lastMessage = data['lastMessage'] as String? ?? '';
                final lastMessageAtString = data['lastMessageAt'] as String? ?? '';
                final hasUnread = data['hasUnreadMessagesForAdmin'] as bool? ?? false;

                String displayTime = '';
                try {
                  if (lastMessageAtString.isNotEmpty) {
                    final date = DateTime.parse(lastMessageAtString).toLocal();
                    displayTime = '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
                  }
                } catch (_) {}

                return Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  decoration: BoxDecoration(
                    color: surfaceColor,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: hasUnread
                          ? const Color(0xFF00D4AA).withAlpha(100)
                          : (isDark ? const Color(0xFF1E2B4C) : const Color(0xFFE2EAF2)),
                      width: hasUnread ? 2 : 1,
                    ),
                  ),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    leading: CircleAvatar(
                      backgroundColor: hasUnread ? const Color(0xFF00D4AA) : const Color(0xFF2F80ED),
                      foregroundColor: Colors.white,
                      child: Text(userName.isNotEmpty ? userName[0].toUpperCase() : '?'),
                    ),
                    title: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            userName,
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w800,
                              color: isDark ? Colors.white : const Color(0xFF0F1A2C),
                            ),
                          ),
                        ),
                        if (displayTime.isNotEmpty)
                          Text(
                            displayTime,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: isDark ? const Color(0xFF8C9FB8) : const Color(0xFF5A6E85),
                            ),
                          ),
                      ],
                    ),
                    subtitle: Padding(
                      padding: const EdgeInsets.only(top: 4.0),
                      child: Text(
                        lastMessage,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: hasUnread
                              ? (isDark ? Colors.white : Colors.black)
                              : (isDark ? const Color(0xFF8C9FB8) : const Color(0xFF5A6E85)),
                          fontWeight: hasUnread ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ),
                    trailing: hasUnread
                        ? Container(
                            width: 10,
                            height: 10,
                            decoration: const BoxDecoration(
                              shape: BoxShape.circle,
                              color: Color(0xFF00D4AA),
                            ),
                          )
                        : null,
                    onTap: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) => SupportChatRoom(
                            roomId: userId,
                            roomName: userName,
                            isAdminChat: true,
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

// -------------------------------------------------------------
// Support Chat Room (Used by both admin and standard user)
// -------------------------------------------------------------
class SupportChatRoom extends StatefulWidget {
  const SupportChatRoom({
    super.key,
    required this.roomId,
    required this.roomName,
    required this.isAdminChat,
  });

  final String roomId;
  final String roomName;
  final bool isAdminChat;

  @override
  State<SupportChatRoom> createState() => _SupportChatRoomState();
}

class _SupportChatRoomState extends State<SupportChatRoom> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  bool _uploadingMedia = false;

  @override
  void initState() {
    super.initState();
    // Mark room as read on entry
    _markRead();
  }

  void _markRead() {
    SupportService.instance.markAsRead(widget.roomId, forAdmin: widget.isAdminChat);
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    _messageController.clear();
    await SupportService.instance.sendMessage(
      roomId: widget.roomId,
      message: text,
    );
    _scrollToBottom();
    _markRead();
  }

  Future<void> _sendMedia() async {
    setState(() {
      _uploadingMedia = true;
    });

    try {
      final imageUrl = await SupportService.instance.pickAndUploadImage(widget.roomId);
      if (imageUrl != null) {
        await SupportService.instance.sendMessage(
          roomId: widget.roomId,
          message: '',
          imageUrl: imageUrl,
        );
        _scrollToBottom();
        _markRead();
      }
    } finally {
      if (mounted) {
        setState(() {
          _uploadingMedia = false;
        });
      }
    }
  }

  void _scrollToBottom() {
    if (_scrollController.hasClients) {
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent + 100,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    }
  }

  void _viewFullImage(String url) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.all(10),
        child: Stack(
          alignment: Alignment.center,
          children: [
            InteractiveViewer(
              child: Image.network(
                url,
                fit: BoxFit.contain,
                loadingBuilder: (context, child, loadingProgress) {
                  if (loadingProgress == null) return child;
                  return const Center(child: CircularProgressIndicator());
                },
              ),
            ),
            Positioned(
              top: 10,
              right: 10,
              child: CircleAvatar(
                backgroundColor: Colors.black54,
                child: IconButton(
                  icon: const Icon(Icons.close, color: Colors.white),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final surfaceColor = isDark ? const Color(0xFF121B2E) : Colors.white;
    final primaryTextColor = isDark ? Colors.white : const Color(0xFF0F1A2C);

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isAdminChat ? widget.roomName : 'Customer Support'),
        elevation: 0,
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
        child: Column(
          children: [
            Expanded(
              child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                stream: SupportService.instance.watchMessages(widget.roomId),
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }

                  final docs = snapshot.data?.docs ?? [];
                  if (docs.isEmpty) {
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24.0),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.support_agent_outlined,
                              size: 64,
                              color: isDark ? const Color(0xFF5A6E85) : const Color(0xFF8C9FB8),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              widget.isAdminChat
                                  ? 'No messages yet in this support chat.'
                                  : 'Hi! Let us know how we can help you. Send a message below to start a chat with our support team.',
                              textAlign: TextAlign.center,
                              style: theme.textTheme.titleMedium?.copyWith(
                                color: isDark ? Colors.white70 : Colors.black87,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }

                  // Auto-scroll on new message
                  WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());

                  return ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    itemCount: docs.length,
                    itemBuilder: (context, index) {
                      final msgData = docs[index].data();
                      final message = msgData['message'] as String? ?? '';
                      final imageUrl = msgData['imageUrl'] as String?;
                      final isAdminSender = msgData['isAdmin'] as bool? ?? false;
                      final senderName = msgData['senderName'] as String? ?? 'User';
                      final createdAtString = msgData['createdAt'] as String? ?? '';

                      final isMe = widget.isAdminChat ? isAdminSender : !isAdminSender;

                      String displayTime = '';
                      try {
                        if (createdAtString.isNotEmpty) {
                          final date = DateTime.parse(createdAtString).toLocal();
                          displayTime = '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
                        }
                      } catch (_) {}

                      return Align(
                        alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                        child: Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          constraints: BoxConstraints(
                            maxWidth: MediaQuery.of(context).size.width * 0.75,
                          ),
                          decoration: BoxDecoration(
                            color: isMe
                                ? const Color(0xFF2F80ED)
                                : (isDark ? const Color(0xFF1E293B) : Colors.white),
                            borderRadius: BorderRadius.only(
                              topLeft: const Radius.circular(16),
                              topRight: const Radius.circular(16),
                              bottomLeft: isMe ? const Radius.circular(16) : Radius.zero,
                              bottomRight: isMe ? Radius.zero : const Radius.circular(16),
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withAlpha(isDark ? 30 : 10),
                                blurRadius: 4,
                                offset: const Offset(0, 2),
                              )
                            ],
                          ),
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (!isMe)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 4.0),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(
                                        senderName,
                                        style: const TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.bold,
                                          color: Color(0xFF00D4AA),
                                        ),
                                      ),
                                      if (isAdminSender) ...[
                                        const SizedBox(width: 4),
                                        const Icon(
                                          Icons.verified,
                                          color: Color(0xFF00D4AA),
                                          size: 14,
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                              if (imageUrl != null)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 6.0),
                                  child: GestureDetector(
                                    onTap: () => _viewFullImage(imageUrl),
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(12),
                                      child: Image.network(
                                        imageUrl,
                                        loadingBuilder: (context, child, loadingProgress) {
                                          if (loadingProgress == null) return child;
                                          return Container(
                                            height: 150,
                                            color: Colors.black12,
                                            child: const Center(
                                              child: CircularProgressIndicator(),
                                            ),
                                          );
                                        },
                                      ),
                                    ),
                                  ),
                                ),
                              if (message.isNotEmpty)
                                Text(
                                  message,
                                  style: TextStyle(
                                    fontSize: 15,
                                    color: isMe
                                        ? Colors.white
                                        : (isDark ? Colors.white70 : Colors.black87),
                                  ),
                                ),
                              const SizedBox(height: 4),
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                mainAxisAlignment: MainAxisAlignment.end,
                                children: [
                                  Text(
                                    displayTime,
                                    style: TextStyle(
                                      fontSize: 10,
                                      color: isMe
                                          ? Colors.white70
                                          : (isDark ? const Color(0xFF8C9FB8) : const Color(0xFF5A6E85)),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: surfaceColor,
                border: Border(
                  top: BorderSide(
                    color: isDark ? const Color(0xFF1E2B4C) : const Color(0xFFE2EAF2),
                  ),
                ),
              ),
              child: Row(
                children: [
                  IconButton(
                    icon: _uploadingMedia
                        ? const SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(
                            Icons.add_photo_alternate_outlined,
                            color: isDark ? const Color(0xFF00D4AA) : const Color(0xFF2F80ED),
                          ),
                    onPressed: _uploadingMedia ? null : _sendMedia,
                  ),
                  Expanded(
                    child: TextField(
                      controller: _messageController,
                      style: TextStyle(color: primaryTextColor),
                      decoration: const InputDecoration(
                        hintText: 'Type a message...',
                        border: InputBorder.none,
                      ),
                      onSubmitted: (_) => _sendMessage(),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.send_rounded),
                    color: const Color(0xFF00D4AA),
                    onPressed: _sendMessage,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
