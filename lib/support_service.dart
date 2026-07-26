import 'dart:io';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';
import 'app_auth_service.dart';
import 'admin_access_service.dart';

class SupportService {
  SupportService._privateConstructor();
  static final SupportService instance = SupportService._privateConstructor();

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseStorage _storage = FirebaseStorage.instance;
  final ImagePicker _picker = ImagePicker();

  static const String supportRoomsCollection = 'support_rooms';
  static const String supportMessagesCollection = 'support_messages';

  // Watch messages for a specific room (userId)
  Stream<QuerySnapshot<Map<String, dynamic>>> watchMessages(String roomId) {
    return _firestore
        .collection(supportMessagesCollection)
        .where('roomId', isEqualTo: roomId)
        .orderBy('createdAt', descending: false)
        .snapshots();
  }

  // Watch support rooms for the admin
  Stream<QuerySnapshot<Map<String, dynamic>>> watchRooms() {
    return _firestore
        .collection(supportRoomsCollection)
        .orderBy('updatedAt', descending: true)
        .snapshots();
  }

  // Pick an image and upload it to Firebase Storage
  Future<String?> pickAndUploadImage(String roomId) async {
    try {
      final XFile? file = await _picker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 70,
        maxWidth: 1080,
      );

      if (file == null) {
        return null;
      }

      final fileRef = _storage.ref().child(
            'support_media/$roomId/${DateTime.now().millisecondsSinceEpoch}_${file.name}',
          );

      final uploadTask = fileRef.putFile(File(file.path));
      final snapshot = await uploadTask;
      final downloadUrl = await snapshot.ref.getDownloadURL();
      return downloadUrl;
    } catch (e) {
      // Re-throw or return null
      return null;
    }
  }

  // Send support message
  Future<void> sendMessage({
    required String roomId,
    required String message,
    String? imageUrl,
  }) async {
    final currentUser = AppAuthService.instance.currentUser;
    if (currentUser == null) return;

    final isAdmin = AdminAccessService.instance.isAdmin;
    final nowString = DateTime.now().toUtc().toIso8601String();

    // 1. Add support message
    await _firestore.collection(supportMessagesCollection).add({
      'roomId': roomId,
      'senderId': currentUser.id,
      'senderName': currentUser.name,
      'message': message.trim(),
      'imageUrl': imageUrl,
      'createdAt': nowString,
      'isAdmin': isAdmin,
    });

    // 2. Determine room metadata
    String roomUserName = currentUser.name;
    if (isAdmin) {
      // If admin sent it, we need to fetch user name or rely on existing room userName
      try {
        final roomDoc = await _firestore.collection(supportRoomsCollection).doc(roomId).get();
        if (roomDoc.exists) {
          roomUserName = roomDoc.data()?['userName'] as String? ?? 'User';
        }
      } catch (_) {}
    }

    // 3. Update support room
    await _firestore.collection(supportRoomsCollection).doc(roomId).set({
      'userId': roomId,
      'userName': roomUserName,
      'lastMessage': imageUrl != null && message.trim().isEmpty ? '[Image]' : message.trim(),
      'lastMessageAt': nowString,
      'hasUnreadMessagesForAdmin': !isAdmin,
      'hasUnreadMessagesForUser': isAdmin,
      'updatedAt': nowString,
    }, SetOptions(merge: true));
  }

  // Mark room messages as read
  Future<void> markAsRead(String roomId, {required bool forAdmin}) async {
    final field = forAdmin ? 'hasUnreadMessagesForAdmin' : 'hasUnreadMessagesForUser';
    await _firestore.collection(supportRoomsCollection).doc(roomId).update({
      field: false,
    }).catchError((_) {});
  }
}
